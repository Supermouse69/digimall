import { TRPCError } from "@trpc/server";


import { buyerDisplayName } from "@/lib/chat-name";
import { distanceKm, fromPoint, isValidLatLng, type LatLng } from "@/lib/geo";
import { isPhMobile, normalizePhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";
import { relationId } from "@/lib/private-files";
import type { Order, PrivateMedia, RiderProfile, StoreOrder, Tenant, User } from "@/payload-types";
import {
  closeConversation,
  ensureTripConversation,
  postChatMessage,
  type ChatActor,
  type ChatCtx,
} from "@/modules/chat/server/chat-service";
import { pushToUsers } from "@/modules/notifications/server/push";
import { getSettings } from "@/modules/settings/server/settings";
import {
  ACTIVE_TRIP_STATUSES,
  approxKm,
  canDeliver,
  canPickUp,
  canRequestRider,
  isClosed,
  requestExpired,
  type DeliveryMode,
  type OrderStatus,
  type StoreOrderStatus,
} from "@/modules/orders/state";

// Rider booking + trips (CLAUDE.md §11.7). Who sees what, and when (CLAUDE.md §10 table):
// - before accepting: the rider sees store names/barangays, the buyer's barangay, mode and fare only
// - from accept until delivered: address, pin, landmark photo, notes, phone numbers (call buttons)
// - after delivery: none of that; the trip chat is read-only; no location is kept
// Takes { payload, req? } like the other services, so tests can run inside a cancelled transaction.

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || "Rider";
const fileUrl = async ({ payload, req }: ChatCtx, id: string | null) =>
  id ? (((await payload.findByID({ collection: "private-media", id, depth: 0, overrideAccess: true, req }).catch(() => null)) as PrivateMedia | null)?.url ?? null) : null;

// ---------- loading ----------

const profileOf = async ({ payload, req }: ChatCtx, riderUserId: string) =>
  ((await payload.find({ collection: "rider-profiles", where: { user: { equals: riderUserId } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0] as
    | RiderProfile
    | undefined) ?? null;

const storeOrdersOf = async ({ payload, req }: ChatCtx, orderId: string) =>
  (await payload.find({ collection: "store-orders", where: { order: { equals: orderId } }, sort: "suffix", depth: 0, pagination: false, overrideAccess: true, req }))
    .docs as StoreOrder[];

const storeById = async ({ payload, req }: ChatCtx, id: string) =>
  (await payload.findByID({ collection: "tenants", id, depth: 0, overrideAccess: true, req })) as Tenant;

const orderByCode = async ({ payload, req }: ChatCtx, code: string) =>
  ((await payload.find({ collection: "orders", where: { code: { equals: code.toUpperCase() } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0] as
    | Order
    | undefined) ?? null;

const loadBuyerOrder = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = await orderByCode(ctx, code);
  if (!order || actor.side !== "buyer" || relationId(order.buyer) !== actor.userId) throw notFound();
  return applyRequestTimer(ctx, order);
};

// Where the first pickup is (the rider list is sorted by distance from here)
const firstPickup = async (ctx: ChatCtx, order: Order) => {
  const open = (await storeOrdersOf(ctx, order.id)).filter((so) => !isClosed(so.status as StoreOrderStatus));
  const first = open[0];
  if (!first) return null;
  const store = await storeById(ctx, relationId(first.tenant)!);
  return { store, location: fromPoint(store.location as [number, number] | null | undefined) };
};

// ---------- rider side: status, Active, location ----------

export const riderStatus = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "rider") throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  const [profile, user] = await Promise.all([
    profileOf(ctx, actor.userId),
    ctx.payload.findByID({ collection: "users", id: actor.userId, depth: 0, overrideAccess: true, req: ctx.req }) as Promise<User>,
  ]);
  return {
    approved: profile?.status === "approved",
    isActive: Boolean(profile?.isActive),
    hasPhone: Boolean(user.phone),
    phone: user.phone ?? null,
    lastLocationAt: profile?.lastLocation?.at ?? null,
  };
};

const hasActiveTrip = async ({ payload, req }: ChatCtx, riderUserId: string) =>
  (await payload.count({ collection: "orders", where: { and: [{ rider: { equals: riderUserId } }, { status: { in: [...ACTIVE_TRIP_STATUSES] } }] }, overrideAccess: true, req })).totalDocs > 0;

export const setActive = async (ctx: ChatCtx, actor: ChatActor, active: boolean, location?: LatLng) => {
  if (actor.side !== "rider") throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  const profile = await profileOf(ctx, actor.userId);
  if (!profile || profile.status !== "approved") throw new TRPCError({ code: "FORBIDDEN", message: "Only approved riders can go Active." });
  if (active) {
    const user = (await ctx.payload.findByID({ collection: "users", id: actor.userId, depth: 0, overrideAccess: true, req: ctx.req })) as User;
    if (!user.phone) throw bad("Add your mobile number first (buyers and stores may need to call you during a trip).");
    if (!location || !isValidLatLng(location)) throw bad("Turn on your phone's location so buyers can find you.");
  } else if (await hasActiveTrip(ctx, actor.userId)) {
    throw bad("Finish your current trip first.");
  }
  await ctx.payload.update({
    collection: "rider-profiles",
    id: profile.id,
    // Going off Active deletes the location right away (CLAUDE.md §9: location only while Active)
    data: { isActive: active, lastLocation: active ? { lat: location!.lat, lng: location!.lng, at: new Date().toISOString() } : { lat: null, lng: null, at: null } },
    overrideAccess: true,
    req: ctx.req,
  });
  return { isActive: active };
};

// Only the latest point is kept (no path history)
export const updateLocation = async (ctx: ChatCtx, actor: ChatActor, location: LatLng) => {
  if (actor.side !== "rider") throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  if (!isValidLatLng(location)) throw bad("Invalid location.");
  const profile = await profileOf(ctx, actor.userId);
  if (!profile || profile.status !== "approved" || !profile.isActive) return { saved: false };
  await ctx.payload.update({
    collection: "rider-profiles",
    id: profile.id,
    data: { lastLocation: { lat: location.lat, lng: location.lng, at: new Date().toISOString() } },
    overrideAccess: true,
    req: ctx.req,
  });
  return { saved: true };
};

export const setRiderPhone = async (ctx: ChatCtx, actor: ChatActor, phone: string) => {
  if (actor.side !== "rider") throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  if (!isPhMobile(phone)) throw bad(PH_MOBILE_HINT);
  await ctx.payload.update({ collection: "users", id: actor.userId, data: { phone: normalizePhMobile(phone) }, overrideAccess: true, req: ctx.req });
  return { phone: normalizePhMobile(phone) };
};

// ---------- buyer side: rider list + request ----------

// Approved, Active, fresh location, not on another request or trip, not already tried for this order
const bookableRiders = async (ctx: ChatCtx, order: Order) => {
  const settings = await getSettings(ctx.payload);
  const freshSince = new Date(Date.now() - settings.riderLocationFreshMinutes * 60_000).toISOString();
  const { docs: profiles } = await ctx.payload.find({
    collection: "rider-profiles",
    where: { and: [{ status: { equals: "approved" } }, { isActive: { equals: true } }, { "lastLocation.at": { greater_than: freshSince } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
    req: ctx.req,
  });
  const { docs: busy } = await ctx.payload.find({
    collection: "orders",
    where: {
      or: [
        { and: [{ status: { equals: "rider_requested" } }, { id: { not_equals: order.id } }] },
        { status: { in: [...ACTIVE_TRIP_STATUSES] } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
    req: ctx.req,
  });
  const busyIds = new Set(busy.flatMap((o) => [relationId(o.rider), o.status === "rider_requested" ? relationId(o.riderRequest?.rider) : null]).filter(Boolean));
  const tried = new Set((order.riderRequest?.tried ?? []).map((t) => relationId(t)));
  const pickup = await firstPickup(ctx, order);
  const riders = [];
  for (const profile of profiles as RiderProfile[]) {
    const userId = relationId(profile.user)!;
    if (busyIds.has(userId) || tried.has(userId)) continue;
    const at = profile.lastLocation;
    if (at?.lat == null || at?.lng == null) continue;
    const km = pickup?.location ? distanceKm(pickup.location, { lat: at.lat, lng: at.lng }) : null;
    riders.push({ userId, profile, km });
  }
  return riders.sort((a, b) => (a.km ?? 9e9) - (b.km ?? 9e9));
};

export const listBookableRiders = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = await loadBuyerOrder(ctx, actor, code);
  if (!canRequestRider(order.status as OrderStatus)) return [];
  const riders = await bookableRiders(ctx, order);
  const list = [];
  for (const rider of riders.slice(0, 10)) {
    const user = (await ctx.payload.findByID({ collection: "users", id: rider.userId, depth: 0, overrideAccess: true, req: ctx.req })) as User;
    list.push({
      riderId: rider.userId,
      // First name, photo and an approximate distance only (no live map before booking)
      firstName: firstName(rider.profile.displayName ?? user.name),
      photoUrl: await fileUrl(ctx, relationId(rider.profile.photo)),
      distance: rider.km === null ? "distance unknown" : approxKm(rider.km),
    });
  }
  return list;
};

const sendRequest = async (ctx: ChatCtx, order: Order, riderUserId: string, auto: boolean) => {
  const settings = await getSettings(ctx.payload);
  const now = Date.now();
  const updated = (await ctx.payload.update({
    collection: "orders",
    id: order.id,
    data: {
      status: "rider_requested",
      riderRequest: {
        rider: riderUserId,
        requestedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + settings.riderRequestSeconds * 1000).toISOString(),
        auto,
        tried: (order.riderRequest?.tried ?? []).map((t) => relationId(t)!).filter(Boolean),
      },
    },
    overrideAccess: true,
    req: ctx.req,
  })) as Order;
  const pickup = await firstPickup(ctx, order);
  await pushToUsers(ctx, [riderUserId], {
    title: order.mode === "fast" ? "🔴 URGENT ride request" : "🟢 New ride request",
    body: `${order.code}: pick up at ${pickup?.store.barangay ?? "a store"}. Accept within ${Math.round(settings.riderRequestSeconds / 60)} min.`,
    url: "/rider",
    tag: `request-${order.id}`,
  });
  return updated;
};

// Auto-pick: the nearest rider who hasn't been tried. None left: back to "ready to book".
const requestNextOrRelease = async (ctx: ChatCtx, order: Order, auto: boolean) => {
  if (auto) {
    const next = (await bookableRiders(ctx, order))[0];
    if (next) return sendRequest(ctx, order, next.userId, true);
  }
  return (await ctx.payload.update({
    collection: "orders",
    id: order.id,
    data: { status: "ready_to_book", riderRequest: { ...order.riderRequest, rider: null, expiresAt: null } },
    overrideAccess: true,
    req: ctx.req,
  })) as Order;
};

const markTried = async (ctx: ChatCtx, order: Order) => {
  const riderId = relationId(order.riderRequest?.rider);
  const tried = [...new Set([...(order.riderRequest?.tried ?? []).map((t) => relationId(t)!), riderId].filter(Boolean))] as string[];
  return (await ctx.payload.update({
    collection: "orders",
    id: order.id,
    data: { riderRequest: { ...order.riderRequest, tried } },
    overrideAccess: true,
    req: ctx.req,
  })) as Order;
};

// Lazy timer: a request nobody answered in time moves on (next rider, or back to the list)
const applyRequestTimer = async (ctx: ChatCtx, order: Order): Promise<Order> => {
  if (!requestExpired(order.status as OrderStatus, order.riderRequest?.expiresAt, Date.now())) return order;
  const tried = await markTried(ctx, order);
  return requestNextOrRelease(ctx, tried, Boolean(order.riderRequest?.auto));
};

export const requestRider = async (ctx: ChatCtx, actor: ChatActor, code: string, choice: { riderId?: string; auto?: boolean }) => {
  const order = await loadBuyerOrder(ctx, actor, code);
  if (!canRequestRider(order.status as OrderStatus)) {
    throw new TRPCError({ code: "CONFLICT", message: order.status === "rider_requested" ? "You already asked a rider. Wait for the answer." : "This order can't book a rider right now." });
  }
  const riders = await bookableRiders(ctx, order);
  const pick = choice.auto ? riders[0] : riders.find((rider) => rider.userId === choice.riderId);
  if (!pick) throw bad(choice.auto ? "No riders are available right now. Please try again in a few minutes." : "That rider isn't available anymore. Pick another one.");
  await sendRequest(ctx, order, pick.userId, Boolean(choice.auto));
  return { requested: true };
};

export const cancelRiderRequest = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = await loadBuyerOrder(ctx, actor, code);
  if (order.status !== "rider_requested") return { cancelled: false };
  await requestNextOrRelease(ctx, await markTried(ctx, order), false);
  return { cancelled: true };
};

// ---------- rider side: incoming request, accept/decline ----------

export const incomingRequest = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "rider") return null;
  const { docs } = await ctx.payload.find({
    collection: "orders",
    where: { and: [{ status: { equals: "rider_requested" } }, { "riderRequest.rider": { equals: actor.userId } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req: ctx.req,
  });
  const raw = docs[0] as Order | undefined;
  if (!raw) return null;
  const order = await applyRequestTimer(ctx, raw);
  if (order.status !== "rider_requested" || relationId(order.riderRequest?.rider) !== actor.userId) return null;
  const stores = [];
  for (const so of (await storeOrdersOf(ctx, order.id)).filter((s) => !isClosed(s.status as StoreOrderStatus))) {
    const store = await storeById(ctx, relationId(so.tenant)!);
    stores.push({ name: store.name, barangay: store.barangay ?? null });
  }
  // Before accepting: no street address, pin, landmark photo or phone numbers (CLAUDE.md §10 table)
  return {
    orderId: order.id,
    code: order.code,
    mode: order.mode as DeliveryMode,
    stores,
    buyerBarangay: order.delivery?.barangay ?? null,
    fareEstimate: order.fare?.estimate ?? null,
    expiresAt: order.riderRequest?.expiresAt ?? null,
  };
};

export const respondToRequest = async (ctx: ChatCtx, actor: ChatActor, orderId: string, accept: boolean) => {
  if (actor.side !== "rider") throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  const raw = (await ctx.payload.findByID({ collection: "orders", id: orderId, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as Order | null;
  if (!raw) throw notFound();
  const order = await applyRequestTimer(ctx, raw);
  if (order.status !== "rider_requested" || relationId(order.riderRequest?.rider) !== actor.userId) {
    throw new TRPCError({ code: "CONFLICT", message: "This request isn't yours anymore (it timed out or was cancelled)." });
  }
  if (!accept) {
    await requestNextOrRelease(ctx, await markTried(ctx, order), Boolean(order.riderRequest?.auto));
    return { accepted: false };
  }
  if (await hasActiveTrip(ctx, actor.userId)) throw bad("Finish your current trip first (one trip at a time).");
  const conversation = await ensureTripConversation(ctx, order, actor.userId);
  await ctx.payload.update({
    collection: "orders",
    id: order.id,
    data: {
      status: "rider_assigned",
      rider: actor.userId,
      riderRequest: { ...order.riderRequest, expiresAt: null },
      trip: { ...order.trip, acceptedAt: new Date().toISOString(), conversation: conversation.id },
    },
    overrideAccess: true,
    req: ctx.req,
  });
  const rider = (await ctx.payload.findByID({ collection: "users", id: actor.userId, depth: 0, overrideAccess: true, req: ctx.req })) as User;
  await postChatMessage(ctx, conversation, {
    side: "system",
    kind: "system",
    text: `🛺 Rider ${firstName(rider.name)} accepted ${order.code} and is heading to the store. You can chat here or call during the trip.`,
    preview: `🛺 Rider ${firstName(rider.name)} accepted ${order.code}`,
    notify: "buyer",
  });
  return { accepted: true, conversationId: conversation.id };
};

// ---------- the trip ----------

const loadActiveTripFor = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "rider") return null;
  const { docs } = await ctx.payload.find({
    collection: "orders",
    where: { and: [{ rider: { equals: actor.userId } }, { status: { in: [...ACTIVE_TRIP_STATUSES] } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req: ctx.req,
  });
  return (docs[0] as Order | undefined) ?? null;
};

// What the rider sees during the trip (and only during it)
export const riderTrip = async (ctx: ChatCtx, actor: ChatActor) => {
  const order = await loadActiveTripFor(ctx, actor);
  if (!order) return null;
  const buyer = (await ctx.payload.findByID({ collection: "users", id: relationId(order.buyer)!, depth: 0, overrideAccess: true, req: ctx.req })) as User;
  const stops = [];
  for (const so of (await storeOrdersOf(ctx, order.id)).filter((s) => !isClosed(s.status as StoreOrderStatus))) {
    const store = await storeById(ctx, relationId(so.tenant)!);
    stops.push({
      storeOrderId: so.id,
      code: so.code,
      storeName: store.name,
      barangay: store.barangay ?? null,
      addressDetails: store.addressDetails ?? null,
      location: fromPoint(store.location as [number, number] | null | undefined),
      phone: store.phone ?? null, // rider -> store calls during the trip
      itemCount: (so.items ?? []).reduce((sum, item) => sum + item.qty, 0),
      status: so.status as StoreOrderStatus,
      canPickUp: canPickUp(order.status as OrderStatus, so.status as StoreOrderStatus),
    });
  }
  return {
    orderId: order.id,
    code: order.code,
    status: order.status as OrderStatus,
    mode: order.mode as DeliveryMode,
    fareEstimate: order.fare?.estimate ?? null,
    riderNotes: order.riderNotes ?? null,
    conversationId: relationId(order.trip?.conversation),
    buyer: {
      name: buyerDisplayName(buyer),
      barangay: order.delivery?.barangay ?? null,
      addressDetails: order.delivery?.addressDetails ?? null,
      location: fromPoint(order.delivery?.location as [number, number] | null | undefined),
      landmarkPhotoUrl: await fileUrl(ctx, relationId(order.delivery?.landmarkPhoto)),
      phone: buyer.phone ?? null, // call button during the active trip only
    },
    stops,
    canDeliver: canDeliver(order.status as OrderStatus, stops.map((stop) => stop.status)),
  };
};

export const pickUp = async (ctx: ChatCtx, actor: ChatActor, storeOrderId: string) => {
  const order = await loadActiveTripFor(ctx, actor);
  if (!order) throw notFound();
  const so = (await ctx.payload.findByID({ collection: "store-orders", id: storeOrderId, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as StoreOrder | null;
  if (!so || relationId(so.order) !== order.id) throw notFound();
  if (!canPickUp(order.status as OrderStatus, so.status as StoreOrderStatus)) throw new TRPCError({ code: "CONFLICT", message: "This stop can't be picked up now." });
  const now = new Date().toISOString();
  await ctx.payload.update({ collection: "store-orders", id: so.id, data: { status: "picked_up", pickedUpAt: now }, overrideAccess: true, req: ctx.req });
  // The FIRST pickup puts the whole order "On the way" (no more cancellations, CLAUDE.md §11.8)
  if (order.status === "rider_assigned") {
    await ctx.payload.update({ collection: "orders", id: order.id, data: { status: "on_the_way", trip: { ...order.trip, firstPickupAt: now } }, overrideAccess: true, req: ctx.req });
  }
  const store = await storeById(ctx, relationId(so.tenant)!);
  const trip = await ctx.payload.findByID({ collection: "conversations", id: relationId(order.trip?.conversation)!, depth: 0, overrideAccess: true, req: ctx.req });
  await postChatMessage(ctx, trip, {
    side: "system",
    kind: "system",
    text: `📦 Picked up ${so.code} from ${store.name}.${order.status === "rider_assigned" ? " Your order is on the way!" : ""}`,
    preview: `📦 Picked up from ${store.name}`,
    notify: "buyer",
  });
  return { picked: true };
};

export const deliver = async (ctx: ChatCtx, actor: ChatActor, orderId: string, feeCollected: number) => {
  const order = await loadActiveTripFor(ctx, actor);
  if (!order || order.id !== orderId) throw notFound();
  if (!Number.isInteger(feeCollected) || feeCollected < 0 || feeCollected > 10_000) throw bad("Enter the cash fee you collected (whole pesos).");
  const storeOrders = await storeOrdersOf(ctx, order.id);
  if (!canDeliver(order.status as OrderStatus, storeOrders.map((so) => so.status as StoreOrderStatus))) {
    throw new TRPCError({ code: "CONFLICT", message: "Pick up every store first." });
  }
  const now = new Date().toISOString();
  for (const so of storeOrders.filter((s) => s.status === "picked_up")) {
    await ctx.payload.update({ collection: "store-orders", id: so.id, data: { status: "delivered", deliveredAt: now }, overrideAccess: true, req: ctx.req });
  }
  await ctx.payload.update({
    collection: "orders",
    id: order.id,
    data: { status: "delivered", trip: { ...order.trip, deliveredAt: now, feeCollected } },
    overrideAccess: true,
    req: ctx.req,
  });
  const tripId = relationId(order.trip?.conversation);
  if (tripId) {
    const trip = await ctx.payload.findByID({ collection: "conversations", id: tripId, depth: 0, overrideAccess: true, req: ctx.req });
    await postChatMessage(ctx, trip, {
      side: "system",
      kind: "system",
      text: `✅ ${order.code} delivered. Thank you! This trip chat is now read-only.`,
      preview: `✅ ${order.code} delivered`,
      notify: "buyer",
    });
    await closeConversation(ctx, tripId);
  }
  return { delivered: true };
};

// Earnings log (CLAUDE.md §11.7): finished trips with the cash fee the rider confirmed
export const riderHistory = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "rider") return { trips: [], total: 0 };
  const { docs } = await ctx.payload.find({
    collection: "orders",
    where: { and: [{ rider: { equals: actor.userId } }, { status: { equals: "delivered" } }] },
    sort: "-trip.deliveredAt",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req: ctx.req,
  });
  const trips = (docs as Order[]).map((order) => ({
    code: order.code,
    mode: order.mode as DeliveryMode,
    deliveredAt: order.trip?.deliveredAt ?? order.updatedAt,
    fee: order.trip?.feeCollected ?? 0,
    // No addresses after delivery (CLAUDE.md §11.7)
    barangay: order.delivery?.barangay ?? null,
  }));
  return { trips, total: trips.reduce((sum, trip) => sum + trip.fee, 0) };
};

// What the buyer sees about the rider
export const buyerTrip = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = await loadBuyerOrder(ctx, actor, code);
  const status = order.status as OrderStatus;
  if (status === "rider_requested") {
    const rider = (await ctx.payload.findByID({ collection: "users", id: relationId(order.riderRequest?.rider)!, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as User | null;
    return { status, pending: { firstName: firstName(rider?.name), expiresAt: order.riderRequest?.expiresAt ?? null, auto: Boolean(order.riderRequest?.auto) }, rider: null, triedCount: order.riderRequest?.tried?.length ?? 0 };
  }
  const riderId = relationId(order.rider);
  if (!riderId) return { status, pending: null, rider: null, triedCount: order.riderRequest?.tried?.length ?? 0 };
  const [user, profile] = await Promise.all([
    ctx.payload.findByID({ collection: "users", id: riderId, depth: 0, overrideAccess: true, req: ctx.req }) as Promise<User>,
    profileOf(ctx, riderId),
  ]);
  const active = ACTIVE_TRIP_STATUSES.includes(status);
  return {
    status,
    pending: null,
    triedCount: 0,
    rider: {
      firstName: firstName(profile?.displayName ?? user.name),
      photoUrl: await fileUrl(ctx, relationId(profile?.photo)),
      // Phone + live location: this buyer's own trip, only while it's active (CLAUDE.md §10 table)
      phone: active ? (user.phone ?? null) : null,
      location: active && profile?.lastLocation?.lat != null && profile.lastLocation.lng != null ? { lat: profile.lastLocation.lat, lng: profile.lastLocation.lng, at: profile.lastLocation.at ?? null } : null,
      conversationId: relationId(order.trip?.conversation),
      feeCollected: status === "delivered" ? (order.trip?.feeCollected ?? null) : null,
    },
  };
};

