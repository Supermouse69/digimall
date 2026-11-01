// Run: bun run test:refunds
// Phase 7 cancellations + refunds + paid-but-unbooked, end to end on the real dev database inside
// transactions that are cancelled (nothing is saved).
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { Order, StoreOrder, Tenant, User } from "../src/payload-types";
import { DEFAULT_SERVICE_CENTER } from "../src/globals/Settings";
import { chatActorFor, getThread, sendMessage, type ChatActor, type ChatCtx } from "../src/modules/chat/server/chat-service";
import { actOnRefund, actOnStoreOrder, buyerOrderDetail, cancelWholeOrder, placeOrder, runOrderTimers, storeBoard, storeOrderView } from "../src/modules/orders/server/order-service";
import { incomingRequest, pickUp, requestRider, respondToRequest, riderTrip } from "../src/modules/trips/server/trip-service";

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};
const refusedWith = (promise: Promise<unknown>) => promise.then(() => "", (error: Error) => error.message || "refused");

const payload = await getPayload({ config });
await Promise.all(
  Object.values(payload.db.collections).map((model) => (model as { init: () => Promise<unknown> }).init()),
);
const STAMP = Date.now();
const C = DEFAULT_SERVICE_CENTER;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

type World = {
  ctx: ChatCtx;
  req: PayloadRequest;
  store: Tenant;
  buyer: ChatActor;
  seller: ChatActor;
  otherSeller: ChatActor;
  rider: ChatActor;
  paidOrder: () => Promise<{ code: string; storeOrderId: string; orderId: string }>;
  file: (owner: string, purpose: string) => Promise<string>;
};

const scenario = async (name: string, run: (w: World) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  const ctx = { payload, req };
  try {
    const user = async (tag: string, data: Record<string, unknown>) =>
      (await payload.create({
        collection: "users",
        data: { email: `refund-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, _verified: true, ...data } as never,
        disableVerificationEmail: true,
        req,
      })) as User;
    const store = (await payload.create({ collection: "tenants", data: { name: `Refund Store ${STAMP}`, slug: `refund-store-${STAMP}`, status: "unverified", barangay: "San Marcos", location: [C.lng, C.lat] }, req })) as Tenant;
    const other = (await payload.create({ collection: "tenants", data: { name: `Other ${STAMP}`, slug: `refund-other-${STAMP}`, status: "unverified" }, req })) as Tenant;
    const sellerUser = await user("seller", { name: "Seller", role: "seller", tenants: [{ tenant: store.id }] });
    const otherSellerUser = await user("other", { name: "Other", role: "seller", tenants: [{ tenant: other.id }] });
    const file = async (owner: string, purpose: string) =>
      ((await payload.db.create({ collection: "private-media", data: { owner, purpose, filename: `rf-${STAMP}-${Math.random().toString(36).slice(2)}.webp`, mimeType: "image/webp" }, req })) as { id: string }).id;
    await payload.db.updateOne({ collection: "tenants", id: store.id, data: { gcashQr: await file(sellerUser.id, "store-gcash-qr"), gcashQrApproved: true }, req });
    const buyerUser = await user("buyer", { name: "Juan", role: "buyer", phone: "09171234567", buyerProfile: { barangay: "San Marcos", addressDetails: "Purok 3", location: [C.lng, C.lat] } });
    const riderUser = await user("rider", { name: "Rex Rider", role: "rider", phone: "09179999999" });
    const profile = await payload.create({ collection: "rider-profiles", data: { user: riderUser.id, displayName: "Rex", status: "approved" }, req });
    await payload.db.updateOne({ collection: "rider-profiles", id: profile.id, data: { isActive: true, lastLocation: { lat: C.lat, lng: C.lng, at: new Date().toISOString() } }, req });
    const category = await payload.create({ collection: "categories", data: { name: `Refund Cat ${STAMP}`, slug: `refund-cat-${STAMP}` }, req });
    const product = await payload.create({ collection: "products", data: { name: "Rice 1kg", price: 60, tenant: store.id, category: category.id }, req });
    const buyer = chatActorFor(buyerUser)!;
    const seller = chatActorFor(sellerUser)!;
    const paidOrder = async () => {
      const { code } = await placeOrder(ctx, buyer, { stores: [{ storeSlug: store.slug, items: [{ productId: product.id, qty: 2 }] }], mode: "casual" });
      const so = (await buyerOrderDetail(ctx, buyer, code)).storeOrders[0]!;
      await actOnStoreOrder(ctx, seller, so.id, "store_confirm");
      await actOnStoreOrder(ctx, buyer, so.id, "submit_payment", { receiptId: await file(buyer.userId, "payment-receipt") });
      await actOnStoreOrder(ctx, seller, so.id, "payment_received");
      const order = (await payload.find({ collection: "orders", where: { code: { equals: code } }, depth: 0, req })).docs[0]!;
      return { code, storeOrderId: so.id, orderId: order.id };
    };
    await run({ ctx, req, store, buyer, seller, otherSeller: chatActorFor(otherSellerUser)!, rider: chatActorFor(riderUser)!, paidOrder, file });
  } catch (error) {
    check(`${name}: unexpected error`, false, (error as Error).stack?.split("\n").slice(0, 3).join(" | "));
  } finally {
    await killTransaction(req);
  }
};

const refundOf = async (w: World, id: string) => ((await payload.findByID({ collection: "store-orders", id, depth: 0, req: w.req })) as StoreOrder).refund;
const orderOf = async (w: World, id: string) => (await payload.findByID({ collection: "orders", id, depth: 0, req: w.req })) as Order;

await scenario("refund flow", async (w) => {
  const { code, storeOrderId, orderId } = await w.paidOrder();
  check("paying every store records when it became ready to book", Boolean((await orderOf(w, orderId)).readyToBookAt));
  await actOnStoreOrder(w.ctx, w.buyer, storeOrderId, "buyer_cancel", { reason: "Changed my mind" });
  const refund = await refundOf(w, storeOrderId);
  check("buyer cancels a PAID store order -> refund starts (waiting for the buyer's QR)", refund?.status === "awaiting_buyer_qr" && refund?.amount === 120, refund);
  check("...the order is cancelled", (await orderOf(w, orderId)).status === "cancelled");
  const view = await storeOrderView(w.ctx, w.buyer, storeOrderId);
  const thread = await getThread(w.ctx, w.seller, view.conversationId!);
  check("...a 'Refund needed' message is posted in the store chat", thread.messages.some((m) => m.kind === "refund_request"));
  check("the store's board pins it as a refund (even though it's cancelled)", (await storeBoard(w.ctx, w.seller)).some((so) => so.id === storeOrderId && so.refund?.status === "awaiting_buyer_qr"));

  check("the store can't mark 'refund sent' before the buyer's QR", (await refusedWith(actOnRefund(w.ctx, w.seller, storeOrderId, "store_refund_sent", await w.file(w.seller.userId, "refund-proof")))) !== "");
  check("someone else's file as the buyer's QR is refused", (await refusedWith(actOnRefund(w.ctx, w.buyer, storeOrderId, "buyer_send_qr", await w.file(w.seller.userId, "refund-qr")))) !== "");
  check("a file uploaded for something else is refused", (await refusedWith(actOnRefund(w.ctx, w.buyer, storeOrderId, "buyer_send_qr", await w.file(w.buyer.userId, "chat-image")))) !== "");
  await actOnRefund(w.ctx, w.buyer, storeOrderId, "buyer_send_qr", await w.file(w.buyer.userId, "refund-qr"));
  const sellerView = await storeOrderView(w.ctx, w.seller, storeOrderId);
  check("buyer sends their QR -> the store must refund, and can open the QR", sellerView.refund?.status === "awaiting_store_refund" && Boolean(sellerView.refund?.buyerQrUrl), sellerView.refund);
  check("another store can't touch this refund", (await refusedWith(actOnRefund(w.ctx, w.otherSeller, storeOrderId, "store_refund_sent", await w.file(w.otherSeller.userId, "refund-proof")))) !== "");
  check("the buyer can't mark the store's step", (await refusedWith(actOnRefund(w.ctx, w.buyer, storeOrderId, "store_refund_sent"))) !== "");
  await actOnRefund(w.ctx, w.seller, storeOrderId, "store_refund_sent", await w.file(w.seller.userId, "refund-proof"));
  const buyerView = await storeOrderView(w.ctx, w.buyer, storeOrderId);
  check("store sends it with proof -> the buyer sees the proof", buyerView.refund?.status === "refund_sent" && Boolean(buyerView.refund?.proofUrl));
  await actOnRefund(w.ctx, w.buyer, storeOrderId, "buyer_refund_received");
  check("buyer confirms -> refunded (closed)", (await refundOf(w, storeOrderId))?.status === "refunded");
  check("a closed refund leaves the active board", !(await storeBoard(w.ctx, w.seller)).some((so) => so.id === storeOrderId));
  check("the whole chat shows QR + proof", ["refund_request", "refund_qr", "refund_proof"].every((kind) => thread.messages.length >= 0 && kind) && (await getThread(w.ctx, w.buyer, view.conversationId!)).messages.filter((m) => m.kind === "refund_qr" || m.kind === "refund_proof").length === 2);
  check("the whole-order cancel button is gone", (await buyerOrderDetail(w.ctx, w.buyer, code)).canCancelOrder === false);
});

await scenario("store cancels paid", async (w) => {
  const { storeOrderId } = await w.paidOrder();
  await actOnStoreOrder(w.ctx, w.seller, storeOrderId, "store_cancel", { reason: "Out of stock" });
  check("store cancels a PAID order -> refund starts too", (await refundOf(w, storeOrderId))?.status === "awaiting_buyer_qr");
});

await scenario("refund timers", async (w) => {
  const a = await w.paidOrder();
  await actOnStoreOrder(w.ctx, w.buyer, a.storeOrderId, "buyer_cancel");
  await actOnRefund(w.ctx, w.buyer, a.storeOrderId, "buyer_send_qr", await w.file(w.buyer.userId, "refund-qr"));
  const r = await refundOf(w, a.storeOrderId);
  await payload.db.updateOne({ collection: "store-orders", id: a.storeOrderId, data: { refund: { ...r, buyerQrAt: hoursAgo(25), startedAt: hoursAgo(26) } }, req: w.req });
  const late = await storeOrderView(w.ctx, w.seller, a.storeOrderId);
  check("store didn't refund within 24 h of the QR -> ESCALATED", late.refund?.status === "escalated", late.refund);
  const audit = await payload.find({ collection: "audit-logs", where: { and: [{ action: { equals: "refund.escalated" } }, { targetId: { equals: a.storeOrderId } }] }, depth: 0, req: w.req });
  check("...and written in the audit log", audit.docs.length === 1);
  check("...the store can still send it", !(await refusedWith(actOnRefund(w.ctx, w.seller, a.storeOrderId, "store_refund_sent", await w.file(w.seller.userId, "refund-proof")))));
  const r2 = await refundOf(w, a.storeOrderId);
  await payload.db.updateOne({ collection: "store-orders", id: a.storeOrderId, data: { refund: { ...r2, sentAt: hoursAgo(73) } }, req: w.req });
  check("buyer never confirms (72 h) -> closed as unconfirmed", (await storeOrderView(w.ctx, w.buyer, a.storeOrderId)).refund?.status === "refunded_unconfirmed");

  const b = await w.paidOrder();
  await actOnStoreOrder(w.ctx, w.buyer, b.storeOrderId, "buyer_cancel");
  const rb = await refundOf(w, b.storeOrderId);
  await payload.db.updateOne({ collection: "store-orders", id: b.storeOrderId, data: { refund: { ...rb, startedAt: hoursAgo(80) } }, req: w.req });
  await storeOrderView(w.ctx, w.buyer, b.storeOrderId);
  check("buyer never sends a QR (3 days) -> flagged to the admin", Boolean((await refundOf(w, b.storeOrderId))?.adminFlaggedAt));

  const c = await w.paidOrder();
  await actOnStoreOrder(w.ctx, w.buyer, c.storeOrderId, "buyer_cancel");
  await actOnRefund(w.ctx, w.buyer, c.storeOrderId, "buyer_send_qr", await w.file(w.buyer.userId, "refund-qr"));
  const rc = await refundOf(w, c.storeOrderId);
  await payload.db.updateOne({ collection: "store-orders", id: c.storeOrderId, data: { refund: { ...rc, startedAt: hoursAgo(5), buyerQrAt: hoursAgo(4) } }, req: w.req });
  const counts = await runOrderTimers(w.ctx);
  check("scheduled job: reminds the seller about the pending refund", counts.sellerReminders >= 1 && Boolean((await refundOf(w, c.storeOrderId))?.lastReminderAt), counts);
  const again = await runOrderTimers(w.ctx);
  check("...but not again right away (every N hours)", (await refundOf(w, c.storeOrderId))?.lastReminderAt === (await refundOf(w, c.storeOrderId))?.lastReminderAt && again.sellerReminders === 0, again);
});

await scenario("paid but not booked", async (w) => {
  const a = await w.paidOrder();
  await payload.db.updateOne({ collection: "orders", id: a.orderId, data: { readyToBookAt: hoursAgo(4) }, req: w.req });
  const reminded = await buyerOrderDetail(w.ctx, w.buyer, a.code);
  check("after 3 h: the reminder is due (banner + push sent once)", reminded.unbooked?.remind === true && Boolean((await orderOf(w, a.orderId)).bookingReminderAt));

  const b = await w.paidOrder();
  await payload.db.updateOne({ collection: "tenants", id: w.store.id, data: { openingTime: "00:00", closingTime: "00:01" }, req: w.req });
  await payload.db.updateOne({ collection: "orders", id: b.orderId, data: { readyToBookAt: hoursAgo(23) }, req: w.req });
  const pickup = await buyerOrderDetail(w.ctx, w.buyer, b.code);
  check("2 h before closing -> SELF-PICKUP", pickup.status === "self_pickup", pickup.status);
  check("...the buyer can't book a rider anymore", (await refusedWith(requestRider(w.ctx, w.buyer, b.code, { auto: true }))) !== "");
  const sellerSees = await storeOrderView(w.ctx, w.seller, b.storeOrderId);
  check("...the store gets 'Buyer picked up'", sellerSees.actions.includes("buyer_picked_up"));
  await actOnStoreOrder(w.ctx, w.seller, b.storeOrderId, "buyer_picked_up");
  check("store taps 'Buyer picked up' -> delivered", (await buyerOrderDetail(w.ctx, w.buyer, b.code)).status === "delivered");

  await payload.db.updateOne({ collection: "tenants", id: w.store.id, data: { openingTime: null, closingTime: null }, req: w.req });
  const c = await w.paidOrder();
  await payload.db.updateOne({ collection: "orders", id: c.orderId, data: { readyToBookAt: hoursAgo(25) }, req: w.req });
  const refunded = await buyerOrderDetail(w.ctx, w.buyer, c.code);
  check("after 1 day not booked/picked up -> cancelled + refund started automatically", refunded.status === "cancelled" && refunded.storeOrders[0]!.refund?.status === "awaiting_buyer_qr", { status: refunded.status, refund: refunded.storeOrders[0]?.refund });
  const audit = await payload.find({ collection: "audit-logs", where: { and: [{ action: { equals: "order.auto_refunded" } }, { targetId: { equals: c.orderId } }] }, depth: 0, req: w.req });
  check("...written in the audit log", audit.docs.length === 1);
});

await scenario("rider + cancel", async (w) => {
  const a = await w.paidOrder();
  await requestRider(w.ctx, w.buyer, a.code, { riderId: w.rider.userId });
  const card = (await incomingRequest(w.ctx, w.rider))!;
  const { conversationId } = (await respondToRequest(w.ctx, w.rider, card.orderId, true)) as { conversationId: string };
  await cancelWholeOrder(w.ctx, w.buyer, a.code, "Ordered by mistake");
  const order = await orderOf(w, a.orderId);
  check("buyer cancels after the rider accepted -> order cancelled, stage recorded", order.status === "cancelled" && order.cancel?.stage === "rider_assigned", order.cancel);
  check("...the rider is released (no trip anymore)", (await riderTrip(w.ctx, w.rider)) === null);
  check("...the trip chat is closed", (await refusedWith(sendMessage(w.ctx, w.rider, { conversationId, text: "hello?" }))).includes("read-only"));
  check("...and the paid store order is being refunded", (await refundOf(w, a.storeOrderId))?.status === "awaiting_buyer_qr");

  const b = await w.paidOrder();
  await requestRider(w.ctx, w.buyer, b.code, { riderId: w.rider.userId });
  await respondToRequest(w.ctx, w.rider, (await incomingRequest(w.ctx, w.rider))!.orderId, true);
  await pickUp(w.ctx, w.rider, (await riderTrip(w.ctx, w.rider))!.stops[0]!.storeOrderId);
  check("after the first pickup: no cancelling", (await refusedWith(actOnStoreOrder(w.ctx, w.buyer, b.storeOrderId, "buyer_cancel"))).includes("on the way"));
  check("...not the whole order either", (await refusedWith(cancelWholeOrder(w.ctx, w.buyer, b.code))).includes("on the way"));
  check("...and the store can't cancel either", (await refusedWith(actOnStoreOrder(w.ctx, w.seller, b.storeOrderId, "store_cancel", { reason: "oops" }))) !== "");
});

const leftovers = await payload.find({ collection: "users", where: { email: { like: "refund-" } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
