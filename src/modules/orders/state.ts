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
  | "payment_not_received";

type Rule = { from: readonly StoreOrderStatus[]; to: StoreOrderStatus | null };

// to: null = the status stays (only a flag changes)
const RULES: Record<StoreOrderAction, Rule> = {
  store_confirm: { from: ["awaiting_store"], to: "awaiting_payment" },
  // Cancelling after the buyer paid needs the refund flow (Phase 7), so it's not allowed yet
  store_cancel: { from: ["awaiting_store", "awaiting_payment"], to: "cancelled" },
  buyer_cancel: { from: ["awaiting_store", "awaiting_payment"], to: "cancelled" },
  submit_payment: { from: ["awaiting_payment"], to: "payment_submitted" },
  payment_received: { from: ["payment_submitted"], to: "paid" },
  payment_not_received: { from: ["payment_submitted"], to: null },
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
  // Rider steps (Phase 6+) are set by the trip flow, not recalculated here
  if (!["in_progress", "ready_to_book", "cancelled"].includes(current)) return current;
  const open = storeStatuses.filter((status) => !isClosed(status));
  if (open.length === 0) return "cancelled";
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
