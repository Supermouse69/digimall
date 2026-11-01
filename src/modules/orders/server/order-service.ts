import { randomInt } from "crypto";
import { TRPCError } from "@trpc/server";
import { commitTransaction, killTransaction, type Where } from "payload";

import { startTransaction } from "@/lib/transaction";

import { PUBLIC_STORE_STATUSES } from "@/lib/access";
import { fromPoint, isValidLatLng, toPoint, type LatLng } from "@/lib/geo";
import { relationId } from "@/lib/private-files";
import type { Media, Order, PrivateMedia, StoreOrder, Tenant, User } from "@/payload-types";
import { closeConversation, ensureStoreConversation, postChatMessage, type ChatActor, type ChatCtx } from "@/modules/chat/server/chat-service";
import { pushToUsers, sellerIdsOfStore } from "@/modules/notifications/server/push";
import { orderPlacedTemplate } from "@/modules/email/templates";
import { getSettings, isInServiceArea, type MarketplaceSettings } from "@/modules/settings/server/settings";

import {
  CODE_ALPHABET,
  canCancelAtStage,
  canDo,
  canRefund,
  isRefundOpen,
  isWithinStoreHours,
  needsRefund,
  nextRefundStatus,
  REFUND_LABELS,
  refundTimer,
  selfPickupCutoff,
  type RefundAction,
  type RefundStatus,
  expiredStatus,
  nextStatus,
  orderStatusFrom,
  STORE_ORDER_LABELS,
  STORE_SUFFIXES,
  type DeliveryMode,
  type OrderStatus,
  type StoreOrderAction,
  type StoreOrderStatus,
} from "../state";

// Cart, checkout and the store order lifecycle (CLAUDE.md §11.4, §11.5). Every check is here:
// who may act, prices from the database (never from the browser), timers, and status changes.
// Takes { payload, req? } like chat-service, so tests can run inside a cancelled transaction.

export const MAX_ITEMS_PER_STORE = 30;
export const MAX_QTY = 20;

const peso = (amount: number) => `₱${amount.toLocaleString("en-PH")}`;
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
const mediaUrl = (value: unknown): string | null =>
  value && typeof value === "object" && "url" in value ? ((value as Media | PrivateMedia).url ?? null) : null;
const isPublicStore = (store: Tenant | null | undefined) =>
  Boolean(store && (PUBLIC_STORE_STATUSES as readonly string[]).includes(store.status));

// Runs `fn` in ONE database transaction (all or nothing), unless the caller already has one (tests)
const inTransaction = async <T>(ctx: ChatCtx, fn: (ctx: ChatCtx) => Promise<T>): Promise<T> => {
  if (ctx.req) return fn(ctx);
  const req = await startTransaction(ctx.payload);
  try {
    const result = await fn({ payload: ctx.payload, req });
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
};

// ---------- cart check + fare ----------

export type CartStoreInput = { storeSlug: string; items: { productId: string; qty: number }[]; note?: string };

type CheckedLine = { productId: string; name: string; price: number; qty: number; lineTotal: number; imageUrl: string | null };
type CheckedStore = {
  store: Tenant;
  storeSlug: string;
  storeName: string;
  logoUrl: string | null;
  lines: CheckedLine[];
  subtotal: number;
  problems: string[];
  note?: string;
};

const findStoreBySlug = async ({ payload, req }: ChatCtx, slug: string) =>
  ((await payload.find({ collection: "tenants", where: { slug: { equals: slug } }, depth: 1, limit: 1, overrideAccess: true, req })).docs[0] as
    | Tenant
    | undefined) ?? null;

// Re-checks the cart against the database: real prices, availability, open stores
const checkCart = async (ctx: ChatCtx, stores: CartStoreInput[], settings: MarketplaceSettings) => {
  if (stores.length === 0) throw bad("Your cart is empty.");
  if (stores.length > settings.maxStoresPerCart) {
    throw bad(`You can order from up to ${settings.maxStoresPerCart} stores at a time.`);
  }
  const checked: CheckedStore[] = [];
  for (const input of stores) {
    const store = await findStoreBySlug(ctx, input.storeSlug);
    if (!store || !isPublicStore(store)) {
      checked.push({ store: store!, storeSlug: input.storeSlug, storeName: store?.name ?? input.storeSlug, logoUrl: null, lines: [], subtotal: 0, problems: ["This store isn't available right now."] });
      continue;
    }
    const problems: string[] = [];
    const items = input.items.filter((item) => item.qty > 0);
    if (items.length === 0) problems.push("No items from this store.");
    if (items.length > MAX_ITEMS_PER_STORE) problems.push(`Max ${MAX_ITEMS_PER_STORE} different items per store.`);
    const ids = [...new Set(items.map((item) => item.productId))];
    const { docs } = await ctx.payload.find({
      collection: "products",
      where: { and: [{ id: { in: ids } }, { tenant: { equals: store.id } }] },
      depth: 1,
      pagination: false,
      overrideAccess: true,
      req: ctx.req,
    });
    const lines: CheckedLine[] = [];
    for (const item of items) {
      const product = docs.find((doc) => doc.id === item.productId);
      if (!product || product.isHidden) {
        problems.push("An item in your cart isn't sold anymore. Remove it to continue.");
        continue;
      }
      if (product.isAvailable === false) problems.push(`"${product.name}" isn't available right now.`);
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) problems.push(`Quantity for "${product.name}" must be 1 to ${MAX_QTY}.`);
      const qty = Math.min(Math.max(Math.floor(item.qty), 1), MAX_QTY);
      lines.push({ productId: product.id, name: product.name, price: product.price, qty, lineTotal: product.price * qty, imageUrl: mediaUrl(product.image) });
    }
    checked.push({
      store,
      storeSlug: store.slug,
      storeName: store.name,
      logoUrl: mediaUrl(store.logo),
      lines,
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      problems,
      note: input.note?.trim().slice(0, 500) || undefined,
    });
  }
  return checked;
};

// Estimated delivery fee (CLAUDE.md §11.11): first pickup store's barangay -> buyer's barangay,
// by mode, + a fee per extra store. null = no rate entered yet (the rider tells the fee).
export const estimateFare = async (
  { payload, req }: ChatCtx,
  input: { fromBarangay: string | null | undefined; toBarangay: string | null | undefined; mode: DeliveryMode; stops: number },
) => {
  const settings = await getSettings(payload);
  const extraStops = Math.max(0, input.stops - 1);
  if (!input.fromBarangay || !input.toBarangay) return { estimate: null, base: null, extraStops, extraStopFee: settings.fareExtraStopFee };
  const { docs } = await payload.find({
    collection: "fares",
    where: { routeKey: { equals: `${input.fromBarangay} -> ${input.toBarangay}` } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  });
  const fare = docs[0];
  if (!fare) return { estimate: null, base: null, extraStops, extraStopFee: settings.fareExtraStopFee };
  const base = input.mode === "fast" ? fare.fastFare : fare.casualFare;
  return { estimate: base + extraStops * settings.fareExtraStopFee, base, extraStops, extraStopFee: settings.fareExtraStopFee };
};

const buyerProfile = async ({ payload, req }: ChatCtx, buyerId: string) => {
  const user = (await payload.findByID({ collection: "users", id: buyerId, depth: 0, overrideAccess: true, req })) as User;
  return {
    user,
    barangay: user.buyerProfile?.barangay ?? null,
    addressDetails: user.buyerProfile?.addressDetails ?? null,
    location: fromPoint(user.buyerProfile?.location as [number, number] | null | undefined),
    landmarkPhoto: relationId(user.buyerProfile?.landmarkPhoto),
    hasPhone: Boolean(user.phone),
  };
};

export type DeliveryInput = { barangay?: string; addressDetails?: string; location?: LatLng };

// The checkout page: what the order would be, with problems to fix before placing it
export const previewCheckout = async (ctx: ChatCtx, actor: ChatActor, input: { stores: CartStoreInput[]; mode: DeliveryMode; delivery?: DeliveryInput }) => {
  if (actor.side !== "buyer") throw new TRPCError({ code: "FORBIDDEN", message: "Use a buyer account to order." });
  const settings = await getSettings(ctx.payload);
  const stores = await checkCart(ctx, input.stores, settings);
  const profile = await buyerProfile(ctx, actor.userId);
  const barangay = input.delivery?.barangay ?? profile.barangay;
  const location = input.delivery?.location ?? profile.location;
  const deliveryProblems: string[] = [];
  if (!profile.hasPhone) deliveryProblems.push("Add your mobile number to your account first.");
  if (!barangay || !settings.barangays.includes(barangay)) deliveryProblems.push("Pick your barangay (inside our delivery area).");
  if (!location || !isValidLatLng(location) || !isInServiceArea(settings, location)) deliveryProblems.push("Drop your delivery pin inside our delivery area.");
  const fare = await estimateFare(ctx, { fromBarangay: stores[0]?.store?.barangay, toBarangay: barangay, mode: input.mode, stops: stores.length });
  return {
    stores: stores.map((store) => ({
      storeSlug: store.storeSlug,
      storeName: store.storeName,
      logoUrl: store.logoUrl,
      lines: store.lines,
      subtotal: store.subtotal,
      problems: store.problems,
    })),
    itemsTotal: stores.reduce((sum, store) => sum + store.subtotal, 0),
    fare,
    delivery: { barangay, addressDetails: input.delivery?.addressDetails ?? profile.addressDetails, location },
    barangays: settings.barangays,
    serviceCenter: settings.serviceCenter,
    serviceRadiusKm: settings.serviceRadiusKm,
    problems: [...deliveryProblems, ...stores.flatMap((store) => store.problems.map((problem) => `${store.storeName}: ${problem}`))],
  };
};

const newOrderCode = async ({ payload, req }: ChatCtx) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = `DM-${Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")}`;
    const { totalDocs } = await payload.count({ collection: "orders", where: { code: { equals: code } }, overrideAccess: true, req });
    if (totalDocs === 0) return code;
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't create an order code. Please try again." });
};

// Submitting checkout: one Order + one Store Order per store, an order card in each store chat
export const placeOrder = async (
  ctx: ChatCtx,
  actor: ChatActor,
  input: { stores: CartStoreInput[]; mode: DeliveryMode; delivery?: DeliveryInput; riderNotes?: string },
) => {
  if (actor.side !== "buyer") throw new TRPCError({ code: "FORBIDDEN", message: "Use a buyer account to order." });
  const preview = await previewCheckout(ctx, actor, input);
  if (preview.problems.length > 0) throw bad(preview.problems[0]!);

  const result = await inTransaction(ctx, async (tx) => {
    const settings = await getSettings(tx.payload);
    const stores = await checkCart(tx, input.stores, settings);
    const profile = await buyerProfile(tx, actor.userId);
    const code = await newOrderCode(tx);
    const now = Date.now();
    const order = (await tx.payload.create({
      collection: "orders",
      data: {
        code,
        buyer: actor.userId,
        status: "in_progress",
        mode: input.mode,
        delivery: {
          buyerName: profile.user.name,
          barangay: preview.delivery.barangay!,
          addressDetails: preview.delivery.addressDetails ?? undefined,
          location: toPoint(preview.delivery.location!),
          landmarkPhoto: profile.landmarkPhoto ?? undefined,
        },
        riderNotes: input.riderNotes?.trim().slice(0, 500) || undefined,
        fare: {
          estimate: preview.fare.estimate ?? undefined,
          base: preview.fare.base ?? undefined,
          extraStops: preview.fare.extraStops,
          extraStopFee: preview.fare.extraStopFee,
        },
      },
      overrideAccess: true,
      req: tx.req,
    })) as Order;

    for (const [index, store] of stores.entries()) {
      const suffix = STORE_SUFFIXES[index]!;
      const conversation = await ensureStoreConversation(tx, actor.userId, store.store.id);
      const storeOrder = (await tx.payload.create({
        collection: "store-orders",
        data: {
          code: `${code}-${suffix}`,
          order: order.id,
          suffix,
          tenant: store.store.id,
          buyer: actor.userId,
          conversation: conversation.id,
          items: store.lines.map((line) => ({ product: line.productId, name: line.name, price: line.price, qty: line.qty })),
          subtotal: store.subtotal,
          status: "awaiting_store",
          expiresAt: new Date(now + settings.storeConfirmMinutes * 60_000).toISOString(),
          storeNotes: store.note,
        },
        overrideAccess: true,
        req: tx.req,
      })) as StoreOrder;
      await postChatMessage(tx, conversation, {
        side: "system",
        kind: "order_card",
        senderId: actor.userId,
        storeOrderId: storeOrder.id,
        text: `New order ${storeOrder.code}: ${store.lines.length} item(s), ${peso(store.subtotal)}. Please confirm or cancel within ${settings.storeConfirmMinutes} minutes.`,
        preview: `🛒 New order ${storeOrder.code} · ${peso(store.subtotal)}`,
        notify: "store",
      });
    }
    return { code, buyer: profile.user, storeCount: stores.length };
  });

  // Order confirmation email (never blocks the order)
  try {
    const { subject, html } = orderPlacedTemplate({ name: result.buyer.name, code: result.code, storeCount: result.storeCount });
    await ctx.payload.sendEmail({ to: result.buyer.email, subject, html });
  } catch (error) {
    ctx.payload.logger.warn(`order ${result.code}: confirmation email not sent (${(error as Error).message})`);
  }
  return { code: result.code };
};

// ---------- loading + timers ----------

const auditSystem = async ({ payload, req }: ChatCtx, action: "refund.escalated" | "order.auto_refunded" | "order.self_pickup", targetCollection: string, targetId: string, details?: Record<string, unknown>) =>
  payload.create({ collection: "audit-logs", overrideAccess: true, req, data: { action, targetCollection, targetId, details } });

// A rider who was asked, or already heading to the store, is released when the whole order is
// cancelled before pickup (CLAUDE.md §11.8). The stage + times stay on the order for the Terms.
const releaseRider = async (ctx: ChatCtx, order: Order) => {
  const riderId = relationId(order.rider) ?? relationId(order.riderRequest?.rider);
  if (!riderId) return;
  await pushToUsers(ctx, [riderId], { title: "Trip cancelled", body: `${order.code} was cancelled before pickup. You're free for other requests.`, url: "/rider", tag: `trip-${order.id}` });
  const tripId = relationId(order.trip?.conversation);
  if (tripId) {
    const trip = await ctx.payload.findByID({ collection: "conversations", id: tripId, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null);
    if (trip) {
      await postChatMessage(ctx, trip, { side: "system", kind: "system", text: `❌ ${order.code} was cancelled before pickup. This trip has ended.`, preview: `❌ ${order.code} cancelled`, notify: "rider" });
      await closeConversation(ctx, tripId);
    }
  }
};

const recomputeOrder = async (ctx: ChatCtx, orderId: string, cause?: { by: "buyer" | "store" | "system"; reason?: string }) => {
  const { payload, req } = ctx;
  const order = (await payload.findByID({ collection: "orders", id: orderId, depth: 0, overrideAccess: true, req })) as Order;
  const { docs } = await payload.find({ collection: "store-orders", where: { order: { equals: orderId } }, depth: 0, pagination: false, overrideAccess: true, req });
  const status = orderStatusFrom(order.status as OrderStatus, docs.map((so) => so.status as StoreOrderStatus));
  if (status !== order.status) {
    const now = new Date().toISOString();
    const data: Record<string, unknown> = { status };
    // When every store became paid: the paid-but-unbooked timers start counting from here
    if (status === "ready_to_book" && !order.readyToBookAt) data.readyToBookAt = now;
    if (status === "cancelled") {
      data.cancel = { by: cause?.by ?? "system", reason: cause?.reason ?? "Every store order was cancelled or expired.", at: now, stage: order.status };
    }
    await payload.update({ collection: "orders", id: orderId, data, overrideAccess: true, req });
    if (status === "cancelled" && (order.status === "rider_requested" || order.status === "rider_assigned")) await releaseRider(ctx, order);
  }
  return status;
};

const conversationOf = async ({ payload, req }: ChatCtx, storeOrder: StoreOrder) => {
  const id = relationId(storeOrder.conversation);
  if (id) {
    const conversation = await payload.findByID({ collection: "conversations", id, depth: 0, overrideAccess: true, req }).catch(() => null);
    if (conversation) return conversation;
  }
  return ensureStoreConversation({ payload, req }, relationId(storeOrder.buyer)!, relationId(storeOrder.tenant)!);
};

// Refund timers (CLAUDE.md §11.9): late store refund -> escalated; buyer never confirms -> closed
// as unconfirmed; buyer never sends a QR -> flagged to the admin
const applyRefundTimers = async (ctx: ChatCtx, storeOrder: StoreOrder): Promise<StoreOrder> => {
  const refund = storeOrder.refund;
  if (!refund?.status) return storeOrder;
  const settings = await getSettings(ctx.payload);
  const change = refundTimer(refund as Parameters<typeof refundTimer>[0], settings, Date.now());
  if (!change.status && !change.flagQr) return storeOrder;
  const now = new Date().toISOString();
  const conversation = await conversationOf(ctx, storeOrder);
  let data: Record<string, unknown>;
  let message: { text: string; preview: string; notify: "buyer" | "store" };
  if (change.status === "escalated") {
    data = { refund: { ...refund, status: "escalated", escalatedAt: now } };
    message = { text: `⚠️ The refund for ${storeOrder.code} is late. The DigiMall admin was told. Store: please send it now.`, preview: `⚠️ Refund for ${storeOrder.code} is late`, notify: "store" };
    await auditSystem(ctx, "refund.escalated", "store-orders", storeOrder.id, { amount: refund.amount });
  } else if (change.status === "refunded_unconfirmed") {
    data = { refund: { ...refund, status: "refunded_unconfirmed" } };
    message = { text: `Refund for ${storeOrder.code} closed: the store sent it, but it wasn't confirmed. If you didn't get it, please report this chat.`, preview: `Refund for ${storeOrder.code} closed`, notify: "buyer" };
  } else {
    data = { refund: { ...refund, adminFlaggedAt: now } };
    message = { text: `Reminder: please send your GCash QR so the store can refund ${storeOrder.code}. The DigiMall admin can now see this refund.`, preview: `Send your GCash QR for ${storeOrder.code}`, notify: "buyer" };
  }
  const updated = (await ctx.payload.update({ collection: "store-orders", id: storeOrder.id, data, overrideAccess: true, req: ctx.req })) as StoreOrder;
  await postChatMessage(ctx, conversation, { side: "system", kind: "system", storeOrderId: storeOrder.id, ...message });
  return updated;
};

// Lazy expiry: an order past its timer is closed the moment anyone looks at it or acts on it
const applyTimers = async (ctx: ChatCtx, storeOrder: StoreOrder): Promise<StoreOrder> => {
  const expired = expiredStatus(storeOrder.status as StoreOrderStatus, storeOrder.expiresAt, Date.now());
  if (!expired) return applyRefundTimers(ctx, storeOrder);
  const settings = await getSettings(ctx.payload);
  const reason =
    expired === "expired"
      ? `The store didn't confirm within ${settings.storeConfirmMinutes} minutes.`
      : `Not paid within ${settings.paymentMinutes} minutes.`;
  const updated = (await ctx.payload.update({
    collection: "store-orders",
    id: storeOrder.id,
    data: { status: expired, expiresAt: null, cancel: { by: "system", reason, at: new Date().toISOString() } },
    overrideAccess: true,
    req: ctx.req,
  })) as StoreOrder;
  await postChatMessage(ctx, await conversationOf(ctx, storeOrder), {
    side: "system",
    kind: "system",
    storeOrderId: storeOrder.id,
    text: `⏰ ${storeOrder.code} ${expired === "expired" ? "expired" : "was cancelled"}: ${reason}`,
    preview: `⏰ ${storeOrder.code} ${expired === "expired" ? "expired" : "cancelled"}`,
    notify: "buyer",
  });
  await recomputeOrder(ctx, relationId(storeOrder.order)!);
  return updated;
};

// Buyer: own orders. Store: its own store orders. Riders see trips through trip-service instead.
const isMember = (actor: ChatActor, storeOrder: StoreOrder) => {
  if (actor.side === "buyer") return relationId(storeOrder.buyer) === actor.userId;
  if (actor.side === "store") return actor.tenantIds.includes(relationId(storeOrder.tenant) ?? "");
  return false;
};

export const loadStoreOrderFor = async (ctx: ChatCtx, actor: ChatActor, id: string) => {
  const storeOrder = (await ctx.payload.findByID({ collection: "store-orders", id, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as StoreOrder | null;
  if (!storeOrder || !isMember(actor, storeOrder)) throw notFound();
  return applyTimers(ctx, storeOrder);
};

// ---------- cancelling (with refunds) ----------

// Cancels one store order. If the buyer already paid, the refund flow starts (CLAUDE.md §11.9):
// the buyer sends their own GCash QR in the chat, then the store sends the money.
const cancelStoreOrder = async (ctx: ChatCtx, storeOrder: StoreOrder, by: "buyer" | "store" | "system", reason: string, senderId?: string) => {
  const now = new Date().toISOString();
  const refund = needsRefund(storeOrder.status as StoreOrderStatus);
  await ctx.payload.update({
    collection: "store-orders",
    id: storeOrder.id,
    data: {
      status: "cancelled",
      expiresAt: null,
      cancel: { by, reason: reason || undefined, at: now },
      ...(refund ? { refund: { status: "awaiting_buyer_qr", amount: storeOrder.subtotal, startedAt: now } } : {}),
    },
    overrideAccess: true,
    req: ctx.req,
  });
  const conversation = await conversationOf(ctx, storeOrder);
  const who = by === "system" ? "DigiMall" : `the ${by}`;
  await postChatMessage(ctx, conversation, {
    side: "system",
    kind: "system",
    senderId,
    storeOrderId: storeOrder.id,
    text: `❌ ${storeOrder.code} was cancelled by ${who}${reason ? `: ${reason}` : "."}`,
    preview: `❌ ${storeOrder.code} cancelled`,
    notify: by === "buyer" ? "store" : "buyer",
  });
  if (refund) {
    await postChatMessage(ctx, conversation, {
      side: "system",
      kind: "refund_request",
      storeOrderId: storeOrder.id,
      text: `💸 Refund needed for ${storeOrder.code}: ${peso(storeOrder.subtotal)}. Buyer: send YOUR GCash QR here (tap "Send my GCash QR" on the order card). Store: send the refund once you have it.`,
      preview: `💸 Refund needed for ${storeOrder.code}`,
      notify: "buyer",
    });
    await pushToUsers(ctx, await sellerIdsOfStore(ctx, relationId(storeOrder.tenant)!), {
      title: "🟠 Refund needed",
      body: `${storeOrder.code}: ${peso(storeOrder.subtotal)} to refund once the buyer sends their GCash QR.`,
      url: "/seller/orders",
      tag: `refund-${storeOrder.id}`,
    });
  }
  return refund;
};

// ---------- actions ----------

const WHO: Record<StoreOrderAction, "buyer" | "store"> = {
  store_confirm: "store",
  store_cancel: "store",
  buyer_cancel: "buyer",
  submit_payment: "buyer",
  payment_received: "store",
  payment_not_received: "store",
  buyer_picked_up: "store",
};

export type ActInput = { reason?: string; receiptId?: string; referenceNo?: string };

const loadOrderById = async ({ payload, req }: ChatCtx, id: string) => (await payload.findByID({ collection: "orders", id, depth: 0, overrideAccess: true, req })) as Order;

export const actOnStoreOrder = async (ctx: ChatCtx, actor: ChatActor, storeOrderId: string, action: StoreOrderAction, input: ActInput = {}) => {
  if (WHO[action] !== actor.side) throw new TRPCError({ code: "FORBIDDEN", message: "You can't do that on this order." });
  return inTransaction(ctx, async (tx) => {
    const storeOrder = await loadStoreOrderFor(tx, actor, storeOrderId);
    const status = storeOrder.status as StoreOrderStatus;
    const order = await loadOrderById(tx, relationId(storeOrder.order)!);
    const isCancel = action === "buyer_cancel" || action === "store_cancel";
    // No cancelling after the first pickup (CLAUDE.md §11.8)
    if (isCancel && !canCancelAtStage(order.status as OrderStatus)) {
      throw new TRPCError({ code: "CONFLICT", message: "Your items are on the way — this order can't be cancelled." });
    }
    if (!canDo(action, status)) throw new TRPCError({ code: "CONFLICT", message: `This order is already: ${STORE_ORDER_LABELS[status]}.` });
    if (action === "buyer_picked_up" && order.status !== "self_pickup") throw new TRPCError({ code: "CONFLICT", message: "Only for self-pickup orders." });

    if (isCancel) {
      const reason = input.reason?.trim().slice(0, 300) ?? "";
      if (action === "store_cancel" && reason.length < 3) throw bad("Please write why you're cancelling (e.g., out of stock).");
      const by = action === "store_cancel" ? "store" : "buyer";
      const refundStarted = await cancelStoreOrder(tx, storeOrder, by, reason, actor.userId);
      const orderStatus = await recomputeOrder(tx, order.id, { by, reason });
      return { status: "cancelled" as StoreOrderStatus, orderStatus, refundStarted };
    }

    const settings = await getSettings(tx.payload);
    const now = new Date();
    const conversation = await conversationOf(tx, storeOrder);
    const data: Record<string, unknown> = { status: nextStatus(action, status) };
    let message: { text: string; preview: string; notify: "buyer" | "store"; kind?: "system" | "payment_receipt"; imageId?: string; side?: "buyer" | "system" };

    switch (action) {
      case "store_confirm": {
        const store = (await tx.payload.findByID({ collection: "tenants", id: relationId(storeOrder.tenant)!, depth: 0, overrideAccess: true, req: tx.req })) as Tenant;
        if (!relationId(store.gcashQr) || !store.gcashQrApproved) {
          throw bad("Your GCash QR isn't approved yet. Upload it in your store settings and wait for the DigiMall admin to approve it.");
        }
        data.confirmedAt = now.toISOString();
        data.expiresAt = new Date(now.getTime() + settings.paymentMinutes * 60_000).toISOString();
        message = {
          text: `✅ The store confirmed ${storeOrder.code}. Please pay ${peso(storeOrder.subtotal)} by GCash within ${settings.paymentMinutes} minutes, then send your receipt.`,
          preview: `✅ ${storeOrder.code} confirmed: please pay ${peso(storeOrder.subtotal)}`,
          notify: "buyer",
        };
        break;
      }
      case "submit_payment": {
        const file = input.receiptId
          ? ((await tx.payload.findByID({ collection: "private-media", id: input.receiptId, depth: 0, overrideAccess: true, req: tx.req }).catch(() => null)) as PrivateMedia | null)
          : null;
        if (!file || relationId(file.owner) !== actor.userId || file.purpose !== "payment-receipt") {
          throw bad("Please upload a photo or screenshot of your GCash receipt.");
        }
        const referenceNo = input.referenceNo?.replace(/\s+/g, "").slice(0, 40) || undefined;
        if (referenceNo && !/^[A-Za-z0-9-]+$/.test(referenceNo)) throw bad("The GCash reference number can only have letters and numbers.");
        // The store sees the receipt because it's posted in their chat with the buyer
        await tx.payload.update({ collection: "private-media", id: file.id, data: { conversation: conversation.id } as never, overrideAccess: true, req: tx.req });
        data.expiresAt = null; // timer stops: the buyer has paid (CLAUDE.md §11.5)
        data.payment = { ...storeOrder.payment, method: "gcash_manual", receipt: file.id, referenceNo, submittedAt: now.toISOString() };
        message = {
          kind: "payment_receipt",
          side: "buyer",
          imageId: file.id,
          text: `💸 Payment receipt for ${storeOrder.code} (${peso(storeOrder.subtotal)})${referenceNo ? ` · Ref. ${referenceNo}` : ""}. Store: please check your GCash, then tap "Payment received".`,
          preview: `💸 Receipt sent for ${storeOrder.code}`,
          notify: "store",
        };
        break;
      }
      case "payment_received": {
        data.payment = { ...storeOrder.payment, confirmedAt: now.toISOString() };
        message = { text: `🟢 Payment received for ${storeOrder.code}. The store is preparing your items.`, preview: `🟢 ${storeOrder.code} paid`, notify: "buyer" };
        break;
      }
      case "payment_not_received": {
        data.payment = { ...storeOrder.payment, notReceivedAt: now.toISOString() };
        message = {
          text: `⚠️ The store says the payment for ${storeOrder.code} hasn't arrived yet. Please check your GCash and talk here. The DigiMall admin can see this flag.`,
          preview: `⚠️ ${storeOrder.code}: payment not received`,
          notify: "buyer",
        };
        break;
      }
      case "buyer_picked_up": {
        data.pickedUpByBuyerAt = now.toISOString();
        data.deliveredAt = now.toISOString();
        message = { text: `📦 You picked up ${storeOrder.code} at the store. Thank you!`, preview: `📦 ${storeOrder.code} picked up at the store`, notify: "buyer" };
        break;
      }
      default:
        throw bad("Unknown action.");
    }

    await tx.payload.update({ collection: "store-orders", id: storeOrder.id, data, overrideAccess: true, req: tx.req });
    await postChatMessage(tx, conversation, {
      side: message.side ?? "system",
      kind: message.kind ?? "system",
      senderId: actor.userId,
      storeOrderId: storeOrder.id,
      imageId: message.imageId,
      text: message.text,
      preview: message.preview,
      notify: message.notify,
    });
    const orderStatus = await recomputeOrder(tx, order.id);
    return { status: data.status as StoreOrderStatus, orderStatus, refundStarted: false };
  });
};

// The buyer cancels the whole order: every store order that can still be cancelled (paid ones
// start a refund). Not possible after the first pickup.
export const cancelWholeOrder = async (ctx: ChatCtx, actor: ChatActor, code: string, reason?: string) => {
  if (actor.side !== "buyer") throw new TRPCError({ code: "FORBIDDEN", message: "Only the buyer can cancel the whole order." });
  const order = await loadOrderFor(ctx, actor, code);
  if (!canCancelAtStage(order.status as OrderStatus)) throw new TRPCError({ code: "CONFLICT", message: "Your items are on the way — this order can't be cancelled." });
  const { docs } = await ctx.payload.find({ collection: "store-orders", where: { order: { equals: order.id } }, depth: 0, pagination: false, overrideAccess: true, req: ctx.req });
  let cancelled = 0;
  let refundsStarted = 0;
  for (const storeOrder of docs as StoreOrder[]) {
    const fresh = await applyTimers(ctx, storeOrder);
    if (canDo("buyer_cancel", fresh.status as StoreOrderStatus)) {
      const result = await actOnStoreOrder(ctx, actor, fresh.id, "buyer_cancel", { reason });
      cancelled++;
      if (result.refundStarted) refundsStarted++;
    }
  }
  return { cancelled, refundsStarted };
};

// ---------- refunds (CLAUDE.md §11.9) ----------

const REFUND_WHO: Record<RefundAction, "buyer" | "store"> = { buyer_send_qr: "buyer", store_refund_sent: "store", buyer_refund_received: "buyer" };

export const actOnRefund = async (ctx: ChatCtx, actor: ChatActor, storeOrderId: string, action: RefundAction, fileId?: string) => {
  if (REFUND_WHO[action] !== actor.side) throw new TRPCError({ code: "FORBIDDEN", message: "You can't do that on this refund." });
  return inTransaction(ctx, async (tx) => {
    const storeOrder = await loadStoreOrderFor(tx, actor, storeOrderId);
    const refund = storeOrder.refund ?? {};
    if (!canRefund(action, refund.status as RefundStatus | null)) {
      throw new TRPCError({ code: "CONFLICT", message: refund.status ? `This refund is already: ${REFUND_LABELS[refund.status as RefundStatus]}.` : "There's no refund for this order." });
    }
    const conversation = await conversationOf(tx, storeOrder);
    const now = new Date().toISOString();
    const needFile = action === "buyer_send_qr" ? "refund-qr" : action === "store_refund_sent" ? "refund-proof" : null;
    if (needFile) {
      const file = fileId
        ? ((await tx.payload.findByID({ collection: "private-media", id: fileId, depth: 0, overrideAccess: true, req: tx.req }).catch(() => null)) as PrivateMedia | null)
        : null;
      if (!file || relationId(file.owner) !== actor.userId || file.purpose !== needFile) {
        throw bad(action === "buyer_send_qr" ? "Please upload a picture of YOUR GCash QR." : "Please upload a screenshot of the GCash refund you sent.");
      }
      // The other side sees it because it's posted in their chat
      await tx.payload.update({ collection: "private-media", id: file.id, data: { conversation: conversation.id } as never, overrideAccess: true, req: tx.req });
    }
    const amount = peso(refund.amount ?? storeOrder.subtotal);
    let data: Record<string, unknown>;
    let message: { kind: "refund_qr" | "refund_proof" | "system"; side: "buyer" | "store" | "system"; text: string; preview: string; notify: "buyer" | "store"; imageId?: string };
    if (action === "buyer_send_qr") {
      data = { ...refund, status: nextRefundStatus(action), buyerQr: fileId, buyerQrAt: now };
      message = { kind: "refund_qr", side: "buyer", imageId: fileId, text: `🧾 My GCash QR for the ${storeOrder.code} refund (${amount}). Store: please send it, then tap "Refund sent".`, preview: `🧾 Buyer's GCash QR for ${storeOrder.code}`, notify: "store" };
    } else if (action === "store_refund_sent") {
      data = { ...refund, status: nextRefundStatus(action), proof: fileId, sentAt: now };
      message = { kind: "refund_proof", side: "store", imageId: fileId, text: `✅ Refund sent for ${storeOrder.code} (${amount}). Buyer: please check your GCash and tap "Refund received".`, preview: `✅ Refund sent for ${storeOrder.code}`, notify: "buyer" };
    } else {
      data = { ...refund, status: nextRefundStatus(action), receivedAt: now };
      message = { kind: "system", side: "system", text: `🟢 The buyer received the ${storeOrder.code} refund. All done.`, preview: `🟢 Refund received for ${storeOrder.code}`, notify: "store" };
    }
    await tx.payload.update({ collection: "store-orders", id: storeOrder.id, data: { refund: data }, overrideAccess: true, req: tx.req });
    await postChatMessage(tx, conversation, { ...message, senderId: actor.userId, storeOrderId: storeOrder.id });
    return { refundStatus: data.status as RefundStatus };
  });
};

// ---------- paid but not booked (developer decision 2026-11-01, CLAUDE.md §8) ----------

// Reminder after N hours -> self-pickup N hours before the store closes -> after N hours cancelled
// and refunded automatically. Checked on every read of the order and by the scheduled job.
export const applyOrderTimers = async (ctx: ChatCtx, order: Order): Promise<Order> => {
  const status = order.status as OrderStatus;
  if ((status !== "ready_to_book" && status !== "self_pickup") || !order.readyToBookAt) return order;
  const settings = await getSettings(ctx.payload);
  const now = Date.now();
  const readyAt = Date.parse(order.readyToBookAt);
  const storeOrders = (await ctx.payload.find({ collection: "store-orders", where: { order: { equals: order.id } }, depth: 0, pagination: false, overrideAccess: true, req: ctx.req })).docs as StoreOrder[];
  const open = storeOrders.filter((so) => so.status === "paid");

  // 1. Still not booked or picked up after N hours: cancel + refund each paid store order
  if (now - readyAt >= settings.autoRefundHours * 3_600_000) {
    return inTransaction(ctx, async (tx) => {
      for (const so of open) {
        await cancelStoreOrder(tx, so, "system", `Not booked or picked up within ${settings.autoRefundHours} hours of payment. The store refunds you.`);
      }
      await auditSystem(tx, "order.auto_refunded", "orders", order.id, { storeOrders: open.map((so) => so.code) });
      await recomputeOrder(tx, order.id, { by: "system", reason: "Auto-refund: no rider booked and not picked up in time." });
      return loadOrderById(tx, order.id);
    });
  }

  // 2. N hours before the (earliest) closing time: the buyer picks up at the store(s)
  if (status === "ready_to_book") {
    const stores = await Promise.all(open.map((so) => ctx.payload.findByID({ collection: "tenants", id: relationId(so.tenant)!, depth: 0, overrideAccess: true, req: ctx.req }) as Promise<Tenant>));
    const cutoffs = stores.map((store) => selfPickupCutoff(order.readyToBookAt!, store.closingTime, settings.selfPickupHoursBeforeClosing)).filter((c): c is number => c !== null);
    const cutoff = cutoffs.length > 0 ? Math.min(...cutoffs) : null;
    if (cutoff !== null && now >= cutoff) {
      const updated = (await ctx.payload.update({ collection: "orders", id: order.id, data: { status: "self_pickup", selfPickupAt: new Date(now).toISOString() }, overrideAccess: true, req: ctx.req })) as Order;
      for (const [index, so] of open.entries()) {
        const store = stores[index]!;
        await postChatMessage(ctx, await conversationOf(ctx, so), {
          side: "system",
          kind: "system",
          storeOrderId: so.id,
          text: `🏪 No rider was booked for ${so.code}, so it's now SELF-PICKUP. Buyer: please pick up your items at ${store.name}${store.closingTime ? ` before ${store.closingTime}` : ""}. Store: tap "Buyer picked up" when they do.`,
          preview: `🏪 ${so.code} is now self-pickup`,
          notify: "buyer",
        });
      }
      await auditSystem(ctx, "order.self_pickup", "orders", order.id);
      return updated;
    }
  }

  // 3. Reminder to book a rider (once)
  if (status === "ready_to_book" && !order.bookingReminderAt && now - readyAt >= settings.bookingReminderHours * 3_600_000) {
    await pushToUsers(ctx, [relationId(order.buyer)!], {
      title: "Book your rider",
      body: `Every store is paid for ${order.code}. Book a rider now, or it becomes self-pickup before the store closes.`,
      url: `/orders/${order.code}`,
      tag: `book-${order.id}`,
    });
    return (await ctx.payload.update({ collection: "orders", id: order.id, data: { bookingReminderAt: new Date(now).toISOString() }, overrideAccess: true, req: ctx.req })) as Order;
  }
  return order;
};

// ---------- scheduled job (/api/cron/order-timers) ----------

// Runs every timer + the repeated reminders. Without a scheduler the timers still run on every read,
// but reminders/pushes only go out when this job runs (suggestions/order timer scheduler.txt).
export const runOrderTimers = async (ctx: ChatCtx) => {
  const settings = await getSettings(ctx.payload);
  const now = Date.now();
  const counts = { orders: 0, storeOrders: 0, refunds: 0, sellerReminders: 0, buyerReminders: 0 };

  const { docs: orders } = await ctx.payload.find({ collection: "orders", where: { status: { in: ["ready_to_book", "self_pickup"] } }, depth: 0, limit: 500, overrideAccess: true, req: ctx.req });
  for (const order of orders as Order[]) {
    const after = await applyOrderTimers(ctx, order);
    if (after.status !== order.status || after.bookingReminderAt !== order.bookingReminderAt) counts.orders++;
  }

  const { docs: timed } = await ctx.payload.find({
    collection: "store-orders",
    where: { and: [{ status: { in: ["awaiting_store", "awaiting_payment"] } }, { expiresAt: { less_than: new Date(now).toISOString() } }] },
    depth: 0,
    limit: 500,
    overrideAccess: true,
    req: ctx.req,
  });
  for (const so of timed as StoreOrder[]) {
    await applyTimers(ctx, so);
    counts.storeOrders++;
  }

  const { docs: refunds } = await ctx.payload.find({
    collection: "store-orders",
    where: { "refund.status": { in: ["awaiting_buyer_qr", "awaiting_store_refund", "refund_sent", "escalated"] } },
    depth: 0,
    limit: 500,
    overrideAccess: true,
    req: ctx.req,
  });
  for (const raw of refunds as StoreOrder[]) {
    const so = await applyRefundTimers(ctx, raw);
    if (so.refund?.status !== raw.refund?.status) counts.refunds++;
    // Repeated reminders, only while the store is open (no pings at night)
    const refund = so.refund;
    const store = (await ctx.payload.findByID({ collection: "tenants", id: relationId(so.tenant)!, depth: 0, overrideAccess: true, req: ctx.req })) as Tenant;
    const last = Date.parse(refund?.lastReminderAt ?? refund?.startedAt ?? new Date(now).toISOString());
    if (!isWithinStoreHours(now, store.openingTime, store.closingTime) || now - last < settings.refundReminderEveryHours * 3_600_000) continue;
    const amount = peso(refund?.amount ?? so.subtotal);
    if (refund?.status === "awaiting_store_refund" || refund?.status === "escalated") {
      await pushToUsers(ctx, await sellerIdsOfStore(ctx, store.id), { title: "🟠 Refund needed", body: `${so.code}: send ${amount} to the buyer's GCash, then tap "Refund sent".`, url: "/seller/orders", tag: `refund-${so.id}` });
      counts.sellerReminders++;
    } else if (refund?.status === "awaiting_buyer_qr") {
      await pushToUsers(ctx, [relationId(so.buyer)!], { title: "Get your refund", body: `Send your GCash QR in the chat so ${store.name} can refund ${amount} (${so.code}).`, url: "/chat", tag: `refund-${so.id}` });
      counts.buyerReminders++;
    } else {
      continue;
    }
    await ctx.payload.update({ collection: "store-orders", id: so.id, data: { refund: { ...refund, lastReminderAt: new Date(now).toISOString() } }, overrideAccess: true, req: ctx.req });
  }
  return counts;
};

// ---------- reading ----------

const loadOrderFor = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = (await ctx.payload.find({ collection: "orders", where: { code: { equals: code.toUpperCase() } }, depth: 0, limit: 1, overrideAccess: true, req: ctx.req })).docs[0] as
    | Order
    | undefined;
  if (!order || actor.side !== "buyer" || relationId(order.buyer) !== actor.userId) throw notFound();
  // Paid-but-unbooked timers run on every look (CLAUDE.md §11.6 lazy timers)
  return applyOrderTimers(ctx, order);
};

export type RefundView = {
  status: RefundStatus;
  label: string;
  amount: number;
  buyerQrUrl: string | null;
  proofUrl: string | null;
  flagged: boolean;
};

export type StoreOrderView = {
  id: string;
  code: string;
  status: StoreOrderStatus;
  statusLabel: string;
  store: { name: string; slug: string; logoUrl: string | null; openingTime: string | null; closingTime: string | null };
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  expiresAt: string | null;
  storeNotes: string | null;
  cancel: { by: string | null; reason: string | null } | null;
  paymentSubmittedAt: string | null;
  paymentNotReceived: boolean;
  paymentNeedsCheck: boolean;
  receiptUrl: string | null;
  referenceNo: string | null;
  gcashQrUrl: string | null;
  conversationId: string | null;
  createdAt: string;
  // The parent order (for the store: what it may see)
  order: { code: string; mode: DeliveryMode; status: OrderStatus; buyerName: string; barangay: string | null };
  actions: StoreOrderAction[];
  // Cancelling now would start a refund (the buyer already paid)
  cancelNeedsRefund: boolean;
  refund: RefundView | null;
  refundActions: RefundAction[];
  viewer: ChatActor["side"];
};

const ACTIONS_FOR: Record<ChatActor["side"], StoreOrderAction[]> = {
  buyer: ["buyer_cancel", "submit_payment"],
  store: ["store_confirm", "store_cancel", "payment_received", "payment_not_received", "buyer_picked_up"],
  rider: [],
};
const REFUND_ACTIONS_FOR: Record<ChatActor["side"], RefundAction[]> = {
  buyer: ["buyer_send_qr", "buyer_refund_received"],
  store: ["store_refund_sent"],
  rider: [],
};

const fileUrlOf = async ({ payload, req }: ChatCtx, id: string | null) =>
  id ? (((await payload.findByID({ collection: "private-media", id, depth: 0, overrideAccess: true, req }).catch(() => null)) as PrivateMedia | null)?.url ?? null) : null;

const toView = async (ctx: ChatCtx, actor: ChatActor, raw: StoreOrder, settings: MarketplaceSettings): Promise<StoreOrderView> => {
  const storeOrder = await applyTimers(ctx, raw);
  const [store, order] = await Promise.all([
    ctx.payload.findByID({ collection: "tenants", id: relationId(storeOrder.tenant)!, depth: 1, overrideAccess: true, req: ctx.req }) as Promise<Tenant>,
    ctx.payload.findByID({ collection: "orders", id: relationId(storeOrder.order)!, depth: 0, overrideAccess: true, req: ctx.req }) as Promise<Order>,
  ]);
  const status = storeOrder.status as StoreOrderStatus;
  const orderStatus = order.status as OrderStatus;
  const payment = storeOrder.payment ?? {};
  // The buyer sees the store's GCash QR only while paying, and only once the admin approved it
  const showQr = actor.side === "buyer" && ["awaiting_payment", "payment_submitted"].includes(status) && store.gcashQrApproved && relationId(store.gcashQr);
  const submittedAt = payment.submittedAt ?? null;
  const refund = storeOrder.refund?.status
    ? {
        status: storeOrder.refund.status as RefundStatus,
        label: REFUND_LABELS[storeOrder.refund.status as RefundStatus],
        amount: storeOrder.refund.amount ?? storeOrder.subtotal,
        buyerQrUrl: await fileUrlOf(ctx, relationId(storeOrder.refund.buyerQr)),
        proofUrl: await fileUrlOf(ctx, relationId(storeOrder.refund.proof)),
        flagged: Boolean(storeOrder.refund.adminFlaggedAt || storeOrder.refund.escalatedAt),
      }
    : null;
  const actions = ACTIONS_FOR[actor.side].filter((action) => {
    if (!canDo(action, status)) return false;
    if ((action === "buyer_cancel" || action === "store_cancel") && !canCancelAtStage(orderStatus)) return false;
    if (action === "buyer_picked_up" && orderStatus !== "self_pickup") return false;
    return true;
  });
  return {
    id: storeOrder.id,
    code: storeOrder.code,
    status,
    statusLabel: STORE_ORDER_LABELS[status],
    store: { name: store.name, slug: store.slug, logoUrl: mediaUrl(store.logo), openingTime: store.openingTime ?? null, closingTime: store.closingTime ?? null },
    items: (storeOrder.items ?? []).map((item) => ({ name: item.name, price: item.price, qty: item.qty })),
    subtotal: storeOrder.subtotal,
    expiresAt: storeOrder.expiresAt ?? null,
    storeNotes: storeOrder.storeNotes ?? null,
    cancel: storeOrder.cancel?.at ? { by: storeOrder.cancel.by ?? null, reason: storeOrder.cancel.reason ?? null } : null,
    paymentSubmittedAt: submittedAt,
    paymentNotReceived: Boolean(payment.notReceivedAt),
    // Not checked by the seller after N minutes: flagged (reminder + admin attention, CLAUDE.md §11.5)
    paymentNeedsCheck: status === "payment_submitted" && Boolean(submittedAt) && Date.now() - Date.parse(submittedAt!) > settings.paymentCheckReminderMinutes * 60_000,
    receiptUrl: await fileUrlOf(ctx, relationId(payment.receipt)),
    referenceNo: payment.referenceNo ?? null,
    gcashQrUrl: showQr ? await fileUrlOf(ctx, relationId(store.gcashQr)) : null,
    conversationId: relationId(storeOrder.conversation),
    createdAt: storeOrder.createdAt,
    order: {
      code: order.code,
      mode: order.mode as DeliveryMode,
      status: orderStatus,
      // Stores see the buyer's name on orders and the barangay only, never the address (CLAUDE.md §10 table)
      buyerName: order.delivery?.buyerName ?? "Buyer",
      barangay: order.delivery?.barangay ?? null,
    },
    actions,
    cancelNeedsRefund: needsRefund(status),
    refund,
    refundActions: refund ? REFUND_ACTIONS_FOR[actor.side].filter((action) => canRefund(action, refund.status)) : [],
    viewer: actor.side,
  };
};

export const storeOrderView = async (ctx: ChatCtx, actor: ChatActor, storeOrderId: string) => {
  const settings = await getSettings(ctx.payload);
  return toView(ctx, actor, await loadStoreOrderFor(ctx, actor, storeOrderId), settings);
};

// "My orders" list
export const buyerOrders = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "buyer") return [];
  const { docs } = await ctx.payload.find({ collection: "orders", where: { buyer: { equals: actor.userId } }, sort: "-createdAt", depth: 0, limit: 50, overrideAccess: true, req: ctx.req });
  const result = [];
  for (const raw of docs as Order[]) {
    const order = await applyOrderTimers(ctx, raw);
    const storeOrders = (await ctx.payload.find({ collection: "store-orders", where: { order: { equals: order.id } }, depth: 0, pagination: false, overrideAccess: true, req: ctx.req })).docs as StoreOrder[];
    const fresh = await Promise.all(storeOrders.map((so) => applyTimers(ctx, so)));
    const current = (await ctx.payload.findByID({ collection: "orders", id: order.id, depth: 0, overrideAccess: true, req: ctx.req })) as Order;
    result.push({
      code: order.code,
      status: current.status as OrderStatus,
      mode: order.mode as DeliveryMode,
      createdAt: order.createdAt,
      storeCount: fresh.length,
      total: fresh.filter((so) => !["cancelled", "expired"].includes(so.status)).reduce((sum, so) => sum + so.subtotal, 0),
      refundPending: fresh.some((so) => isRefundOpen(so.refund?.status as RefundStatus | null)),
    });
  }
  return result;
};

// One order with all its store orders (buyer)
export const buyerOrderDetail = async (ctx: ChatCtx, actor: ChatActor, code: string) => {
  const order = await loadOrderFor(ctx, actor, code);
  const settings = await getSettings(ctx.payload);
  const storeOrders = (await ctx.payload.find({ collection: "store-orders", where: { order: { equals: order.id } }, sort: "suffix", depth: 0, pagination: false, overrideAccess: true, req: ctx.req })).docs as StoreOrder[];
  const views = [];
  for (const storeOrder of storeOrders) views.push(await toView(ctx, actor, storeOrder, settings));
  const current = (await ctx.payload.findByID({ collection: "orders", id: order.id, depth: 0, overrideAccess: true, req: ctx.req })) as Order;
  const status = current.status as OrderStatus;
  const readyAt = current.readyToBookAt ? Date.parse(current.readyToBookAt) : null;
  return {
    code: order.code,
    status,
    mode: order.mode as DeliveryMode,
    createdAt: order.createdAt,
    // The buyer's own delivery pin (for their trip map)
    delivery: {
      barangay: order.delivery?.barangay ?? null,
      addressDetails: order.delivery?.addressDetails ?? null,
      location: fromPoint(order.delivery?.location as [number, number] | null | undefined),
    },
    riderNotes: order.riderNotes ?? null,
    fareEstimate: order.fare?.estimate ?? null,
    itemsTotal: views.filter((view) => !["cancelled", "expired"].includes(view.status)).reduce((sum, view) => sum + view.subtotal, 0),
    storeOrders: views,
    canCancelOrder: views.some((view) => view.actions.includes("buyer_cancel")),
    // Paid but not booked: what happens when (developer decision 2026-11-01)
    unbooked:
      readyAt && (status === "ready_to_book" || status === "self_pickup")
        ? {
            remind: Date.now() - readyAt >= settings.bookingReminderHours * 3_600_000,
            autoRefundAt: new Date(readyAt + settings.autoRefundHours * 3_600_000).toISOString(),
            selfPickupHoursBeforeClosing: settings.selfPickupHoursBeforeClosing,
          }
        : null,
  };
};

// Seller's Orders board (tile grid, CLAUDE.md §13). Refunds the store still owes stay on the board
// (pinned on top) even though the order itself is cancelled.
export const storeBoard = async (ctx: ChatCtx, actor: ChatActor, filter: "active" | "done" = "active") => {
  if (actor.side !== "store") return [];
  const settings = await getSettings(ctx.payload);
  const openRefund: Where = { "refund.status": { in: ["awaiting_buyer_qr", "awaiting_store_refund", "refund_sent", "escalated"] } };
  const where: Where = {
    and: [
      { tenant: { in: actor.tenantIds } },
      filter === "active"
        ? { or: [{ status: { in: ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"] } }, openRefund] }
        : { status: { in: ["picked_up", "delivered", "cancelled", "expired"] } },
    ],
  };
  const { docs } = await ctx.payload.find({ collection: "store-orders", where, sort: "-createdAt", depth: 0, limit: 100, overrideAccess: true, req: ctx.req });
  // Paid-but-unbooked timers of these orders run on every look too
  const orderIds = [...new Set((docs as StoreOrder[]).map((so) => relationId(so.order)!))];
  for (const id of orderIds) await applyOrderTimers(ctx, await loadOrderById(ctx, id));
  const views = [];
  for (const storeOrder of docs as StoreOrder[]) {
    const fresh = (await ctx.payload.findByID({ collection: "store-orders", id: storeOrder.id, depth: 0, overrideAccess: true, req: ctx.req })) as StoreOrder;
    views.push(await toView(ctx, actor, fresh, settings));
  }
  const refundOpen = (view: StoreOrderView) => isRefundOpen(view.refund?.status);
  const active = views.filter((view) => !["cancelled", "expired"].includes(view.status) || refundOpen(view));
  // 🟠 REFUND NEEDED first (CLAUDE.md §11.9)
  return filter === "active" ? active.sort((a, b) => Number(refundOpen(b)) - Number(refundOpen(a))) : views.filter((view) => !refundOpen(view));
};

// Bubble number for sellers: orders waiting for the store to act (incl. refunds to send)
export const storeAttentionCount = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "store") return 0;
  const views = await storeBoard(ctx, actor, "active");
  return views.filter(
    (view) => view.status === "awaiting_store" || view.status === "payment_submitted" || view.refundActions.includes("store_refund_sent") || (view.order.status === "self_pickup" && view.status === "paid"),
  ).length;
};
