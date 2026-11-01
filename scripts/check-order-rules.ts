// Run: bun run test:order-rules
// The order state machine (CLAUDE.md §11.5): which step can happen when, the timers, and when the
// parent order becomes "ready to book". No database.
import {
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
check("buyer cancels only BEFORE paying (paid = refund flow, Phase 7)", allowedFrom("buyer_cancel"), ["awaiting_store", "awaiting_payment"]);
check("store cancels only BEFORE payment", allowedFrom("store_cancel"), ["awaiting_store", "awaiting_payment"]);
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

console.log("--- Order codes ---");
check("DM-7K3Q is valid", isOrderCode("DM-7K3Q"), true);
check("look-alike O/0/I/1 are never used", ["DM-O7K3", "DM-07K3", "DM-I7K3", "DM-17K3"].map(isOrderCode), [false, false, false, false]);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
