// Run: bun run test:order-rules
// The order state machine (CLAUDE.md §11.5): which step can happen when, the timers, and when the
// parent order becomes "ready to book". No database.
import {
  canCancelAtStage,
  canRefund,
  isWithinStoreHours,
  needsRefund,
  refundTimer,
  selfPickupCutoff,
  approxKm,
  canDeliver,
  canPickUp,
  canRequestRider,
  requestExpired,
  canDo,
  expiredStatus,
  isOrderCode,
  nextStatus,
  orderStatusFrom,
  STORE_ORDER_STATUSES,
  type StoreOrderAction,
  type StoreOrderStatus,
} from "../src/modules/orders/state";

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};
const allowedFrom = (action: StoreOrderAction) => STORE_ORDER_STATUSES.filter((status) => canDo(action, status));

console.log("--- Who can do what, when ---");
check("store confirms only a new order", allowedFrom("store_confirm"), ["awaiting_store"]);
check("buyer pays only after the store confirmed", allowedFrom("submit_payment"), ["awaiting_payment"]);
check("store marks paid only after a receipt was sent", allowedFrom("payment_received"), ["payment_submitted"]);
check("'not received' only after a receipt was sent", allowedFrom("payment_not_received"), ["payment_submitted"]);
check("buyer can cancel until pickup (paid ones start a refund)", allowedFrom("buyer_cancel"), ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"]);
check("store can cancel until pickup (paid ones start a refund)", allowedFrom("store_cancel"), ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"]);
check("cancelling a paid or receipt-sent order needs a refund", [needsRefund("paid"), needsRefund("payment_submitted"), needsRefund("awaiting_payment")], [true, true, false]);
check("no cancelling once on the way / delivered", [canCancelAtStage("rider_assigned"), canCancelAtStage("on_the_way"), canCancelAtStage("delivered")], [true, false, false]);
check("'Buyer picked up' only for a paid store order", allowedFrom("buyer_picked_up"), ["paid"]);
check("confirm -> waiting for payment", nextStatus("store_confirm", "awaiting_store"), "awaiting_payment");
check("receipt -> payment submitted", nextStatus("submit_payment", "awaiting_payment"), "payment_submitted");
check("payment received -> paid", nextStatus("payment_received", "payment_submitted"), "paid");
check("'not received' keeps the status (flag only)", nextStatus("payment_not_received", "payment_submitted"), "payment_submitted");

console.log("--- Timers (lazy expiry) ---");
const now = Date.parse("2026-11-01T10:00:00Z");
const past = "2026-11-01T09:59:00Z";
const future = "2026-11-01T10:05:00Z";
check("store didn't confirm in time -> expired", expiredStatus("awaiting_store", past, now), "expired");
check("buyer didn't pay in time -> cancelled", expiredStatus("awaiting_payment", past, now), "cancelled");
check("timer not up yet -> nothing", expiredStatus("awaiting_store", future, now), null);
check("receipt sent: NEVER auto-cancelled", expiredStatus("payment_submitted", past, now), null);
check("paid: never expires", expiredStatus("paid", past, now), null);

console.log("--- Parent order ---");
const o = (statuses: StoreOrderStatus[]) => orderStatusFrom("in_progress", statuses);
check("one store paid -> ready to book", o(["paid"]), "ready_to_book");
check("one paid, one still waiting -> in progress", o(["paid", "awaiting_payment"]), "in_progress");
check("one paid, one cancelled -> ready to book (buyer removed the stuck store)", o(["paid", "cancelled"]), "ready_to_book");
check("one paid, one expired -> ready to book", o(["paid", "expired"]), "ready_to_book");
check("receipt sent but not checked -> NOT ready (must be paid)", o(["payment_submitted"]), "in_progress");
check("everything cancelled/expired -> cancelled", o(["cancelled", "expired"]), "cancelled");
check("rider steps are never recalculated here", orderStatusFrom("on_the_way", ["cancelled"]), "on_the_way");

console.log("--- Rider booking + trip ---");
check("book a rider only when ready to book", ["in_progress", "ready_to_book", "rider_requested", "on_the_way"].map((s) => canRequestRider(s as never)), [false, true, false, false]);
check("request timer up -> expired", requestExpired("rider_requested", past, now), true);
check("request timer not up", requestExpired("rider_requested", future, now), false);
check("pick up a PAID store order during the trip", canPickUp("rider_assigned", "paid"), true);
check("can't pick up before the rider accepted", canPickUp("rider_requested", "paid"), false);
check("can't pick up an unpaid store order", canPickUp("on_the_way", "payment_submitted"), false);
check("deliver once every store is picked up", canDeliver("on_the_way", ["picked_up", "cancelled"]), true);
check("not before every store is picked up", canDeliver("on_the_way", ["picked_up", "paid"]), false);
check("not before the first pickup", canDeliver("rider_assigned", ["paid"]), false);
check("approx distance ~0.8 km", approxKm(0.83), "~0.8 km");
check("approx distance ~12 km", approxKm(12.4), "~12 km");

console.log("--- Refunds ---");
check("refund steps: QR -> sent -> received", [canRefund("buyer_send_qr", "awaiting_buyer_qr"), canRefund("store_refund_sent", "awaiting_store_refund"), canRefund("buyer_refund_received", "refund_sent")], [true, true, true]);
check("store can still send after escalation", canRefund("store_refund_sent", "escalated"), true);
check("can't confirm before it was sent", canRefund("buyer_refund_received", "awaiting_store_refund"), false);
const H = { refundStoreHours: 24, refundBuyerConfirmHours: 72, refundQrFlagDays: 3 };
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
check("store late (24 h after the buyer's QR) -> escalated", refundTimer({ status: "awaiting_store_refund", buyerQrAt: hoursAgo(25) }, H, now), { status: "escalated" });
check("buyer never confirms (72 h) -> closed unconfirmed", refundTimer({ status: "refund_sent", sentAt: hoursAgo(73) }, H, now), { status: "refunded_unconfirmed" });
check("buyer never sends a QR (3 days) -> flagged to admin", refundTimer({ status: "awaiting_buyer_qr", startedAt: hoursAgo(73) }, H, now), { flagQr: true });
check("not yet -> nothing", refundTimer({ status: "awaiting_store_refund", buyerQrAt: hoursAgo(2) }, H, now), {});

console.log("--- Self-pickup + store hours (Asia/Manila) ---");
// 2026-11-01 10:00 Manila = 02:00 UTC
const readyMorning = "2026-11-01T02:00:00Z";
check("closes 21:00, 2 h before -> self-pickup at 19:00 Manila (11:00 UTC)", new Date(selfPickupCutoff(readyMorning, "21:00", 2)!).toISOString(), "2026-11-01T11:00:00.000Z");
check("ready AFTER that day's cut-off -> next day's 19:00", new Date(selfPickupCutoff("2026-11-01T12:00:00Z", "21:00", 2)!).toISOString(), "2026-11-02T11:00:00.000Z");
check("no closing time set -> no self-pickup", selfPickupCutoff(readyMorning, null, 2), null);
check("10:00 Manila is within 07:00–21:00", isWithinStoreHours(Date.parse(readyMorning), "07:00", "21:00"), true);
check("22:00 Manila is outside 07:00–21:00 (no reminders at night)", isWithinStoreHours(Date.parse("2026-11-01T14:00:00Z"), "07:00", "21:00"), false);
check("no hours set -> always", isWithinStoreHours(now, null, null), true);
check("self-pickup order: all picked up -> delivered", orderStatusFrom("self_pickup", ["delivered", "cancelled"]), "delivered");
check("everything cancelled while a rider was assigned -> cancelled (rider released)", orderStatusFrom("rider_assigned", ["cancelled"]), "cancelled");

console.log("--- Order codes ---");
check("DM-7K3Q is valid", isOrderCode("DM-7K3Q"), true);
check("look-alike O/0/I/1 are never used", ["DM-O7K3", "DM-07K3", "DM-I7K3", "DM-17K3"].map(isOrderCode), [false, false, false, false]);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
