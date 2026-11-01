import type { GlobalConfig } from "payload";

import { superAdminOnly } from "@/lib/access";

// Admin-editable defaults (CLAUDE.md §11: never hardcode durations, limits, or the service area).
// The buyer site reads these through server code; there is no public REST access.
export const DEFAULT_BARANGAYS = ["San Marcos", "Balite", "Sergio Bayan", "Buguion"];

// Approximate center of Calumpit, Bulacan (used for the "is this pin in our area?" check)
export const DEFAULT_SERVICE_CENTER = { lat: 14.916, lng: 120.766 };
export const DEFAULT_SERVICE_RADIUS_KM = 8;
export const DEFAULT_MINIMUM_AGE = 18;
export const DEFAULT_CHAT_RETENTION_DAYS = 90;
export const ORDER_DEFAULTS = {
  maxStoresPerCart: 3,
  storeConfirmMinutes: 10,
  paymentMinutes: 10,
  paymentCheckReminderMinutes: 30,
  fareExtraStopFee: 0,
  riderRequestSeconds: 120,
  riderLocationFreshMinutes: 5,
  bookingReminderHours: 3,
  selfPickupHoursBeforeClosing: 2,
  autoRefundHours: 24,
  refundReminderEveryHours: 3,
  refundStoreHours: 24,
  refundBuyerConfirmHours: 72,
  refundQrFlagDays: 3,
};

export const Settings: GlobalConfig = {
  slug: "settings",
  label: "Settings",
  access: {
    read: superAdminOnly,
    update: superAdminOnly,
  },
  admin: {
    description: "Marketplace settings. Only the super-admin can see or change these.",
  },
  fields: [
    {
      type: "collapsible",
      label: "Service area",
      fields: [
        {
          name: "barangays",
          label: "Barangays we deliver to",
          type: "array",
          required: true,
          minRows: 1,
          defaultValue: DEFAULT_BARANGAYS.map((name) => ({ name })),
          admin: {
            description: "Buyers pick one of these at sign-up. Removing one doesn't change existing accounts.",
          },
          fields: [{ name: "name", type: "text", required: true, maxLength: 60 }],
        },
        {
          name: "serviceCenter",
          label: "Service area center (for the map)",
          type: "point",
          required: true,
          defaultValue: [DEFAULT_SERVICE_CENTER.lng, DEFAULT_SERVICE_CENTER.lat],
          admin: {
            description: "Longitude, latitude. The sign-up map starts here.",
          },
        },
        {
          name: "serviceRadiusKm",
          label: "Max distance from the center (km)",
          type: "number",
          required: true,
          min: 1,
          max: 50,
          defaultValue: DEFAULT_SERVICE_RADIUS_KM,
          admin: {
            description: "A buyer's map pin must be within this straight-line distance.",
          },
        },
      ],
    },
    {
      type: "collapsible",
      label: "Sign-up",
      fields: [
        {
          name: "minimumAge",
          label: "Minimum age",
          type: "number",
          required: true,
          min: 1,
          max: 100,
          defaultValue: DEFAULT_MINIMUM_AGE,
          admin: {
            description: "Shown in the sign-up checkbox (\"I am at least __ years old\"). Must match your Terms.",
          },
        },
        {
          name: "signupKeyPoints",
          label: "Sign-up box: \"Before you join\"",
          type: "textarea",
          maxLength: 2000,
          defaultValue: "[Developer: write this]",
          admin: {
            description:
              "Shown on the sign-up page. One point per line (a leading * or - is fine). Cover: cancellation once 'On the way', delivery fee, refunds, paid-but-unbooked orders.",
          },
        },
        {
          name: "checkoutKeyPoints",
          label: "Checkout box: \"Quick reminders\"",
          type: "textarea",
          maxLength: 2000,
          defaultValue: "[Developer: write this]",
          admin: {
            description: "Shown at checkout (built in Phase 5). One point per line (a leading * or - is fine).",
          },
        },
      ],
    },
    {
      type: "collapsible",
      label: "Orders + timers",
      fields: [
        { name: "maxStoresPerCart", label: "Max stores per cart", type: "number", required: true, min: 1, max: 10, defaultValue: ORDER_DEFAULTS.maxStoresPerCart },
        {
          name: "storeConfirmMinutes",
          label: "Minutes a store has to confirm a new order",
          type: "number",
          required: true,
          min: 1,
          max: 240,
          defaultValue: ORDER_DEFAULTS.storeConfirmMinutes,
          admin: { description: "After this the store order expires and the buyer is told (CLAUDE.md §11.5)." },
        },
        {
          name: "paymentMinutes",
          label: "Minutes the buyer has to pay after the store confirms",
          type: "number",
          required: true,
          min: 1,
          max: 240,
          defaultValue: ORDER_DEFAULTS.paymentMinutes,
          admin: { description: "Unpaid after this = cancelled automatically. Once a receipt is sent there is NO auto-cancel." },
        },
        {
          name: "paymentCheckReminderMinutes",
          label: "Minutes before a not-yet-checked payment is flagged",
          type: "number",
          required: true,
          min: 5,
          max: 1440,
          defaultValue: ORDER_DEFAULTS.paymentCheckReminderMinutes,
          admin: { description: "If the seller hasn't tapped Payment received / Not received by then, it's flagged for you." },
        },
        {
          name: "fareExtraStopFee",
          label: "Delivery fee for each extra store stop (₱, whole pesos)",
          type: "number",
          required: true,
          min: 0,
          max: 1000,
          defaultValue: ORDER_DEFAULTS.fareExtraStopFee,
          admin: { description: "Added to the base fare (Fares) for every store after the first. Paid in cash to the rider." },
        },
        {
          name: "riderRequestSeconds",
          label: "Seconds a rider has to accept a request",
          type: "number",
          required: true,
          min: 30,
          max: 600,
          defaultValue: ORDER_DEFAULTS.riderRequestSeconds,
        },
        {
          name: "riderLocationFreshMinutes",
          label: "Show riders whose location is at most this many minutes old",
          type: "number",
          required: true,
          min: 1,
          max: 30,
          defaultValue: ORDER_DEFAULTS.riderLocationFreshMinutes,
        },
      ],
    },
    {
      type: "collapsible",
      label: "Paid but not booked + refunds",
      admin: { description: "Developer decision 2026-11-01 (CLAUDE.md §8). Times use each store's opening/closing time (set in the store, super-admin only)." },
      fields: [
        { name: "bookingReminderHours", label: "Remind the buyer to book a rider after (hours)", type: "number", required: true, min: 1, max: 48, defaultValue: ORDER_DEFAULTS.bookingReminderHours },
        { name: "selfPickupHoursBeforeClosing", label: "Becomes self-pickup this many hours before the store closes", type: "number", required: true, min: 0, max: 12, defaultValue: ORDER_DEFAULTS.selfPickupHoursBeforeClosing },
        { name: "autoRefundHours", label: "Still not booked/picked up after (hours): cancel + refund automatically", type: "number", required: true, min: 1, max: 336, defaultValue: ORDER_DEFAULTS.autoRefundHours },
        { name: "refundReminderEveryHours", label: "Remind the seller about a pending refund every (hours, during store hours)", type: "number", required: true, min: 1, max: 24, defaultValue: ORDER_DEFAULTS.refundReminderEveryHours },
        { name: "refundStoreHours", label: "Seller must send the refund within (hours) of the buyer's QR, else escalated to you", type: "number", required: true, min: 1, max: 168, defaultValue: ORDER_DEFAULTS.refundStoreHours },
        { name: "refundBuyerConfirmHours", label: "Buyer doesn't confirm 'Refund received' within (hours): closed as unconfirmed", type: "number", required: true, min: 1, max: 336, defaultValue: ORDER_DEFAULTS.refundBuyerConfirmHours },
        { name: "refundQrFlagDays", label: "Buyer hasn't sent their GCash QR after (days): flagged to you", type: "number", required: true, min: 1, max: 30, defaultValue: ORDER_DEFAULTS.refundQrFlagDays },
      ],
    },
    {
      type: "collapsible",
      label: "Chat",
      fields: [
        {
          name: "chatRetentionDays",
          label: "Delete chats after (days)",
          type: "number",
          required: true,
          min: 7,
          max: 365,
          defaultValue: DEFAULT_CHAT_RETENTION_DAYS,
          admin: {
            description:
              "Messages are deleted this many days after the last message (CLAUDE.md §11.3). Chats under a report are kept until you resolve it.",
          },
        },
      ],
    },
  ],
};
