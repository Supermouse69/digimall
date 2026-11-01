import { randomInt } from "crypto";
import { TRPCError } from "@trpc/server";
import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Where } from "payload";

import { PUBLIC_STORE_STATUSES } from "@/lib/access";
import { fromPoint, isValidLatLng, toPoint, type LatLng } from "@/lib/geo";
import { relationId } from "@/lib/private-files";
import type { Media, Order, PrivateMedia, StoreOrder, Tenant, User } from "@/payload-types";
import { ensureStoreConversation, postChatMessage, type ChatActor, type ChatCtx } from "@/modules/chat/server/chat-service";
import { orderPlacedTemplate } from "@/modules/email/templates";
import { getSettings, isInServiceArea, type MarketplaceSettings } from "@/modules/settings/server/settings";

import {
  CODE_ALPHABET,
  canDo,
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
  const req = await createLocalReq({}, ctx.payload);
  await initTransaction(req);
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

const recomputeOrder = async ({ payload, req }: ChatCtx, orderId: string) => {
  const order = (await payload.findByID({ collection: "orders", id: orderId, depth: 0, overrideAccess: true, req })) as Order;
  const { docs } = await payload.find({ collection: "store-orders", where: { order: { equals: orderId } }, depth: 0, pagination: false, overrideAccess: true, req });
  const status = orderStatusFrom(order.status as OrderStatus, docs.map((so) => so.status as StoreOrderStatus));
  if (status !== order.status) {
    await payload.update({
      collection: "orders",
      id: orderId,
      data: { status, ...(status === "cancelled" ? { cancel: { by: "system", reason: "Every store order was cancelled or expired.", at: new Date().toISOString() } } : {}) },
      overrideAccess: true,
      req,
    });
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

// Lazy expiry: an order past its timer is closed the moment anyone looks at it or acts on it
const applyTimers = async (ctx: ChatCtx, storeOrder: StoreOrder): Promise<StoreOrder> => {
  const expired = expiredStatus(storeOrder.status as StoreOrderStatus, storeOrder.expiresAt, Date.now());
  if (!expired) return storeOrder;
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

// ---------- actions ----------

const WHO: Record<StoreOrderAction, "buyer" | "store"> = {
  store_confirm: "store",
  store_cancel: "store",
  buyer_cancel: "buyer",
  submit_payment: "buyer",
  payment_received: "store",
  payment_not_received: "store",
};

export type ActInput = { reason?: string; receiptId?: string; referenceNo?: string };

export const actOnStoreOrder = async (ctx: ChatCtx, actor: ChatActor, storeOrderId: string, action: StoreOrderAction, input: ActInput = {}) => {
  if (WHO[action] !== actor.side) throw new TRPCError({ code: "FORBIDDEN", message: "You can't do that on this order." });
  return inTransaction(ctx, async (tx) => {
    const storeOrder = await loadStoreOrderFor(tx, actor, storeOrderId);
    const status = storeOrder.status as StoreOrderStatus;
    if (!canDo(action, status)) {
      if ((action === "buyer_cancel" || action === "store_cancel") && ["payment_submitted", "paid"].includes(status)) {
        throw new TRPCError({ code: "CONFLICT", message: "This order is already paid. Talk in the chat; paid-order cancellations and refunds come in a later update." });
      }
      throw new TRPCError({ code: "CONFLICT", message: `This order is already: ${STORE_ORDER_LABELS[status]}.` });
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
      case "store_cancel":
      case "buyer_cancel": {
        const reason = input.reason?.trim().slice(0, 300) ?? "";
        if (action === "store_cancel" && reason.length < 3) throw bad("Please write why you're cancelling (e.g., out of stock).");
        const by = action === "store_cancel" ? "store" : "buyer";
        data.expiresAt = null;
        data.cancel = { by, reason: reason || undefined, at: now.toISOString() };
        message = {
          text: `❌ ${storeOrder.code} was cancelled by the ${by}${reason ? `: ${reason}` : "."}`,
          preview: `❌ ${storeOrder.code} cancelled`,
          notify: by === "store" ? "buyer" : "store",
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
        message = {
          text: `🟢 Payment received for ${storeOrder.code}. The store is preparing your items.`,
          preview: `🟢 ${storeOrder.code} paid`,
          notify: "buyer",
        };
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
    const orderStatus = await recomputeOrder(tx, relationId(storeOrder.order)!);
    return { status: data.status as StoreOrderStatus, orderStatus };
  });
};

// The buyer cancels the whole order: every store order that can still be cancelled
export const cancelWholeOrder = async (ctx: ChatCtx, actor: ChatActor, code: string, reason?: string) => {
  if (actor.side !== "buyer") throw new TRPCError({ code: "FORBIDDEN", message: "Only the buyer can cancel the whole order." });
  const order = await loadOrderFor(ctx, actor, code);
  const { docs } = await ctx.payload.find({ collection: "store-orders", where: { order: { equals: order.id } }, depth: 0, pagination: false, overrideAccess: true, req: ctx.req });
  let cancelled = 0;
  let kept = 0;
  for (const storeOrder of docs as StoreOrder[]) {
    const fresh = await applyTimers(ctx, storeOrder);
    if (canDo("buyer_cancel", fresh.status as StoreOrderStatus)) {
      await actOnStoreOrder(ctx, actor, fresh.id, "buyer_cancel", { reason });
      cancelled++;
    } else if (["payment_submitted", "paid"].includes(fresh.status)) {
      kept++;
    }
  }
  return { cancelled, keptPaid: kept };
};

// ---------- reading ----------

const loadOrderFor = async ({ payload, req }: ChatCtx, actor: ChatActor, code: string) => {
  const order = (await payload.find({ collection: "orders", where: { code: { equals: code.toUpperCase() } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0] as
    | Order
    | undefined;
  if (!order || actor.side !== "buyer" || relationId(order.buyer) !== actor.userId) throw notFound();
  return order;
};

export type StoreOrderView = {
  id: string;
  code: string;
  status: StoreOrderStatus;
  statusLabel: string;
  store: { name: string; slug: string; logoUrl: string | null };
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
  viewer: ChatActor["side"];
};

const ACTIONS_FOR: Record<ChatActor["side"], StoreOrderAction[]> = {
  buyer: ["buyer_cancel", "submit_payment"],
  store: ["store_confirm", "store_cancel", "payment_received", "payment_not_received"],
  rider: [],
};

const toView = async (ctx: ChatCtx, actor: ChatActor, raw: StoreOrder, settings: MarketplaceSettings): Promise<StoreOrderView> => {
  const storeOrder = await applyTimers(ctx, raw);
  const [store, order] = await Promise.all([
    ctx.payload.findByID({ collection: "tenants", id: relationId(storeOrder.tenant)!, depth: 1, overrideAccess: true, req: ctx.req }) as Promise<Tenant>,
    ctx.payload.findByID({ collection: "orders", id: relationId(storeOrder.order)!, depth: 0, overrideAccess: true, req: ctx.req }) as Promise<Order>,
  ]);
  const status = storeOrder.status as StoreOrderStatus;
  const payment = storeOrder.payment ?? {};
  const receipt = relationId(payment.receipt)
    ? ((await ctx.payload.findByID({ collection: "private-media", id: relationId(payment.receipt)!, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as PrivateMedia | null)
    : null;
  // The buyer sees the store's GCash QR only while paying, and only once the admin approved it
  let gcashQrUrl: string | null = null;
  if (actor.side === "buyer" && ["awaiting_payment", "payment_submitted"].includes(status) && store.gcashQrApproved && relationId(store.gcashQr)) {
    const qr = (await ctx.payload.findByID({ collection: "private-media", id: relationId(store.gcashQr)!, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as PrivateMedia | null;
    gcashQrUrl = qr?.url ?? null;
  }
  const submittedAt = payment.submittedAt ?? null;
  return {
    id: storeOrder.id,
    code: storeOrder.code,
    status,
    statusLabel: STORE_ORDER_LABELS[status],
    store: { name: store.name, slug: store.slug, logoUrl: mediaUrl(store.logo) },
    items: (storeOrder.items ?? []).map((item) => ({ name: item.name, price: item.price, qty: item.qty })),
    subtotal: storeOrder.subtotal,
    expiresAt: storeOrder.expiresAt ?? null,
    storeNotes: storeOrder.storeNotes ?? null,
    cancel: storeOrder.cancel?.at ? { by: storeOrder.cancel.by ?? null, reason: storeOrder.cancel.reason ?? null } : null,
    paymentSubmittedAt: submittedAt,
    paymentNotReceived: Boolean(payment.notReceivedAt),
    // Not checked by the seller after N minutes: flagged (reminder + admin attention, CLAUDE.md §11.5)
    paymentNeedsCheck: status === "payment_submitted" && Boolean(submittedAt) && Date.now() - Date.parse(submittedAt!) > settings.paymentCheckReminderMinutes * 60_000,
    receiptUrl: receipt?.url ?? null,
    referenceNo: payment.referenceNo ?? null,
    gcashQrUrl,
    conversationId: relationId(storeOrder.conversation),
    createdAt: storeOrder.createdAt,
    order: {
      code: order.code,
      mode: order.mode as DeliveryMode,
      status: order.status as OrderStatus,
      // Stores see the buyer's name on orders and the barangay only, never the address (CLAUDE.md §10 table)
      buyerName: order.delivery?.buyerName ?? "Buyer",
      barangay: order.delivery?.barangay ?? null,
    },
    actions: ACTIONS_FOR[actor.side].filter((action) => canDo(action, status)),
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
  for (const order of docs as Order[]) {
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
  return {
    code: order.code,
    status: current.status as OrderStatus,
    mode: order.mode as DeliveryMode,
    createdAt: order.createdAt,
    delivery: { barangay: order.delivery?.barangay ?? null, addressDetails: order.delivery?.addressDetails ?? null },
    riderNotes: order.riderNotes ?? null,
    fareEstimate: order.fare?.estimate ?? null,
    itemsTotal: views.filter((view) => !["cancelled", "expired"].includes(view.status)).reduce((sum, view) => sum + view.subtotal, 0),
    storeOrders: views,
    canCancelOrder: views.some((view) => view.actions.includes("buyer_cancel")),
  };
};

// Seller's Orders board (tile grid, CLAUDE.md §13)
export const storeBoard = async (ctx: ChatCtx, actor: ChatActor, filter: "active" | "done" = "active") => {
  if (actor.side !== "store") return [];
  const settings = await getSettings(ctx.payload);
  const where: Where = {
    and: [
      { tenant: { in: actor.tenantIds } },
      filter === "active"
        ? { status: { in: ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"] } }
        : { status: { in: ["picked_up", "delivered", "cancelled", "expired"] } },
    ],
  };
  const { docs } = await ctx.payload.find({ collection: "store-orders", where, sort: "-createdAt", depth: 0, limit: 100, overrideAccess: true, req: ctx.req });
  const views = [];
  for (const storeOrder of docs as StoreOrder[]) views.push(await toView(ctx, actor, storeOrder, settings));
  // An order that just expired moves out of "active"
  return filter === "active" ? views.filter((view) => !["cancelled", "expired"].includes(view.status)) : views;
};

// Bubble number for sellers: orders waiting for the store to act
export const storeAttentionCount = async (ctx: ChatCtx, actor: ChatActor) => {
  if (actor.side !== "store") return 0;
  const views = await storeBoard(ctx, actor, "active");
  return views.filter((view) => view.status === "awaiting_store" || view.status === "payment_submitted").length;
};
