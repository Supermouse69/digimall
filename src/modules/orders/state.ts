// Order + store order state machine (CLAUDE.md §11.5). Pure functions only (no database), so the
// rules can be tested directly and are shared by the server and the screens.
// Phase 5: confirm / cancel / pay / payment received. Rider steps come in Phase 6, refunds in Phase 7.

export const STORE_ORDER_STATUSES = [
  "awaiting_store",
  "awaiting_payment",
  "payment_submitted",
  "paid",
  "picked_up",
  "delivered",
  "cancelled",
  "expired",
] as const;
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

export const ORDER_STATUSES = [
  "in_progress",
  "ready_to_book",
  "rider_requested",
  "rider_assigned",
  "on_the_way",
  "delivered",
  "cancelled",
  "self_pickup",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DELIVERY_MODES = ["casual", "fast"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export type StoreOrderAction =
  | "store_confirm"
  | "store_cancel"
  | "buyer_cancel"
  | "submit_payment"
  | "payment_received"
  | "payment_not_received"
  | "buyer_picked_up";

type Rule = { from: readonly StoreOrderStatus[]; to: StoreOrderStatus | null };

// to: null = the status stays (only a flag changes)
const RULES: Record<StoreOrderAction, Rule> = {
  store_confirm: { from: ["awaiting_store"], to: "awaiting_payment" },
  // Cancelling after the buyer paid starts the refund flow (Phase 7). Never after pickup (§11.8).
  store_cancel: { from: ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"], to: "cancelled" },
  buyer_cancel: { from: ["awaiting_store", "awaiting_payment", "payment_submitted", "paid"], to: "cancelled" },
  submit_payment: { from: ["awaiting_payment"], to: "payment_submitted" },
  payment_received: { from: ["payment_submitted"], to: "paid" },
  payment_not_received: { from: ["payment_submitted"], to: null },
  // Self-pickup: the store hands the items to the buyer at the store
  buyer_picked_up: { from: ["paid"], to: "delivered" },
};

export const canDo = (action: StoreOrderAction, status: StoreOrderStatus) => RULES[action].from.includes(status);
export const nextStatus = (action: StoreOrderAction, status: StoreOrderStatus): StoreOrderStatus => RULES[action].to ?? status;

export const isClosed = (status: StoreOrderStatus) => status === "cancelled" || status === "expired";

// Lazy expiry (CLAUDE.md §11.6): checked on every read and every action, so no frequent cron is needed.
// After a receipt is submitted there is never an auto-cancel.
export const expiredStatus = (status: StoreOrderStatus, expiresAt: string | null | undefined, now: number): StoreOrderStatus | null => {
  if (!expiresAt || Date.parse(expiresAt) > now) return null;
  if (status === "awaiting_store") return "expired";
  if (status === "awaiting_payment") return "cancelled";
  return null;
};

// Parent order status from its store orders (Phase 5 part of §11.5)
export const orderStatusFrom = (current: OrderStatus, storeStatuses: StoreOrderStatus[]): OrderStatus => {
  const open = storeStatuses.filter((status) => !isClosed(status));
  // Once on the way, the trip flow decides (no cancelling after pickup)
  if (current === "on_the_way" || current === "delivered") return current;
  // Everything cancelled: the whole order is cancelled (a waiting/assigned rider is released)
  if (open.length === 0) return "cancelled";
  if (current === "self_pickup") return open.every((status) => status === "delivered") ? "delivered" : "self_pickup";
  // Rider requested/assigned: stays while at least one store order is still in the order
  if (current === "rider_requested" || current === "rider_assigned") return current;
  // Book rider only when EVERY non-cancelled store order is paid (developer decision 2026-10-31)
  if (open.every((status) => status === "paid")) return "ready_to_book";
  return "in_progress";
};

// What the buyer and store see
export const STORE_ORDER_LABELS: Record<StoreOrderStatus, string> = {
  awaiting_store: "Waiting for the store",
  awaiting_payment: "Waiting for your GCash payment",
  payment_submitted: "Payment sent: store is checking",
  paid: "Paid: store is preparing",
  picked_up: "Picked up by rider",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired (store didn't answer)",
};

export const ORDER_LABELS: Record<OrderStatus, string> = {
  in_progress: "In progress",
  ready_to_book: "Ready: book a rider",
  rider_requested: "Rider requested",
  rider_assigned: "Rider on the way to the store",
  on_the_way: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  self_pickup: "Pick up at the store",
};

// Order codes: DM-XXXX with no look-alike characters (no 0/O, 1/I) (CLAUDE.md §13)
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const STORE_SUFFIXES = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"] as const;
export const isOrderCode = (code: string) => /^DM-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code);

// ---------- Rider booking + trip (Phase 6, CLAUDE.md §11.7) ----------

export const ACTIVE_TRIP_STATUSES: readonly OrderStatus[] = ["rider_assigned", "on_the_way"];

export const canRequestRider = (status: OrderStatus) => status === "ready_to_book";

// The rider's few minutes to accept are up (checked on every read and action, like the other timers)
export const requestExpired = (status: OrderStatus, expiresAt: string | null | undefined, now: number) =>
  status === "rider_requested" && Boolean(expiresAt) && Date.parse(expiresAt!) <= now;

// The rider can pick up a store's items once that store order is paid
export const canPickUp = (orderStatus: OrderStatus, storeStatus: StoreOrderStatus) =>
  ACTIVE_TRIP_STATUSES.includes(orderStatus) && storeStatus === "paid";

// "Delivered" only after every store that's still in the order was picked up
export const canDeliver = (orderStatus: OrderStatus, storeStatuses: StoreOrderStatus[]) => {
  const open = storeStatuses.filter((status) => !isClosed(status));
  return orderStatus === "on_the_way" && open.length > 0 && open.every((status) => status === "picked_up");
};

// Approximate distance for the rider list: "~0.8 km" (straight line, CLAUDE.md §11.13)
export const approxKm = (km: number) => `~${km < 10 ? (Math.round(km * 10) / 10).toFixed(1) : Math.round(km)} km`;

// ---------- Cancellations + refunds (Phase 7, CLAUDE.md §11.8, §11.9) ----------

// Cancelling is possible until the first pickup (then: "Your items are on the way")
export const canCancelAtStage = (orderStatus: OrderStatus) =>
  !["on_the_way", "delivered", "cancelled"].includes(orderStatus);

// The buyer already sent money: cancelling means the store must refund
export const needsRefund = (status: StoreOrderStatus) => status === "payment_submitted" || status === "paid";

export const REFUND_STATUSES = ["awaiting_buyer_qr", "awaiting_store_refund", "refund_sent", "refunded", "refunded_unconfirmed", "escalated"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type RefundAction = "buyer_send_qr" | "store_refund_sent" | "buyer_refund_received";

const REFUND_RULES: Record<RefundAction, { from: readonly RefundStatus[]; to: RefundStatus }> = {
  buyer_send_qr: { from: ["awaiting_buyer_qr"], to: "awaiting_store_refund" },
  // The store can still send the refund after it was escalated
  store_refund_sent: { from: ["awaiting_store_refund", "escalated"], to: "refund_sent" },
  buyer_refund_received: { from: ["refund_sent"], to: "refunded" },
};
export const canRefund = (action: RefundAction, status: RefundStatus | null | undefined) => Boolean(status && REFUND_RULES[action].from.includes(status));
export const nextRefundStatus = (action: RefundAction) => REFUND_RULES[action].to;
export const isRefundOpen = (status: RefundStatus | null | undefined) =>
  status === "awaiting_buyer_qr" || status === "awaiting_store_refund" || status === "refund_sent" || status === "escalated";

export const REFUND_LABELS: Record<RefundStatus, string> = {
  awaiting_buyer_qr: "Refund: waiting for the buyer's GCash QR",
  awaiting_store_refund: "🟠 REFUND NEEDED: store must send the money",
  refund_sent: "Refund sent: waiting for the buyer to confirm",
  refunded: "Refunded",
  refunded_unconfirmed: "Refund sent (buyer didn't confirm)",
  escalated: "🟠 REFUND NEEDED (late: the DigiMall admin was told)",
};

type RefundTimes = { status?: RefundStatus | null; startedAt?: string | null; buyerQrAt?: string | null; sentAt?: string | null; adminFlaggedAt?: string | null };
type RefundHours = { refundStoreHours: number; refundBuyerConfirmHours: number; refundQrFlagDays: number };

// Lazy refund timers: what should change now (CLAUDE.md §11.9)
export const refundTimer = (refund: RefundTimes, hours: RefundHours, now: number): { status?: RefundStatus; flagQr?: boolean } => {
  const after = (iso: string | null | undefined, h: number) => Boolean(iso) && now - Date.parse(iso!) >= h * 3_600_000;
  if (refund.status === "awaiting_store_refund" && after(refund.buyerQrAt, hours.refundStoreHours)) return { status: "escalated" };
  if (refund.status === "refund_sent" && after(refund.sentAt, hours.refundBuyerConfirmHours)) return { status: "refunded_unconfirmed" };
  if (refund.status === "awaiting_buyer_qr" && !refund.adminFlaggedAt && after(refund.startedAt, hours.refundQrFlagDays * 24)) return { flagQr: true };
  return {};
};

// ---------- Store hours (Asia/Manila, UTC+8, no daylight saving) ----------

const MANILA_OFFSET_MS = 8 * 3_600_000;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const manilaMinutesOfDay = (at: number) => Math.floor(((at + MANILA_OFFSET_MS) % 86_400_000) / 60_000);
const manilaMidnight = (at: number) => at - ((at + MANILA_OFFSET_MS) % 86_400_000);

// The self-pickup moment: N hours before closing, on the day the order became ready
// (or the next day, if it became ready after that day's cut-off). No closing time set = never.
export const selfPickupCutoff = (readyAt: string, closingTime: string | null | undefined, hoursBefore: number): number | null => {
  if (!closingTime || !/^\d{2}:\d{2}$/.test(closingTime)) return null;
  const ready = Date.parse(readyAt);
  const cutoffMinutes = toMinutes(closingTime) - hoursBefore * 60;
  let cutoff = manilaMidnight(ready) + cutoffMinutes * 60_000;
  if (cutoff <= ready) cutoff += 86_400_000;
  return cutoff;
};

// Reminders to the seller only while the store is open (no pings at night). No hours set = always.
export const isWithinStoreHours = (at: number, openingTime: string | null | undefined, closingTime: string | null | undefined) => {
  if (!openingTime || !closingTime) return true;
  const now = manilaMinutesOfDay(at);
  const open = toMinutes(openingTime);
  const close = toMinutes(closingTime);
  return open <= close ? now >= open && now < close : now >= open || now < close;
};
