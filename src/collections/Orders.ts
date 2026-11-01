import type { CollectionConfig } from "payload";

import { isSuperAdmin, superAdminOnly } from "@/lib/access";
import { DELIVERY_MODES, ORDER_STATUSES } from "@/modules/orders/state";

const locked = { update: () => false };

// One checkout = one Order (DM-XXXX) with one Store Order per store (CLAUDE.md §11.4).
// Closed to the API: buyers and sellers go through the orders server code, which checks who they
// are. Order records are kept for legal/dispute reasons (CLAUDE.md §9 RA 11967): never auto-deleted.
export const Orders: CollectionConfig = {
  slug: "orders",
  access: {
    read: superAdminOnly,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  admin: {
    useAsTitle: "code",
    defaultColumns: ["code", "status", "mode", "buyer", "createdAt"],
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  fields: [
    { name: "code", type: "text", required: true, unique: true, index: true, access: locked },
    { name: "buyer", type: "relationship", relationTo: "users", required: true, index: true, access: locked },
    { name: "status", type: "select", required: true, defaultValue: "in_progress", options: [...ORDER_STATUSES], index: true, access: locked },
    { name: "mode", label: "Delivery mode", type: "select", required: true, options: [...DELIVERY_MODES], access: locked },
    {
      // Where to deliver, copied at checkout (later profile changes don't move an order)
      name: "delivery",
      type: "group",
      fields: [
        { name: "buyerName", type: "text", access: locked },
        { name: "barangay", type: "text", access: locked },
        { name: "addressDetails", type: "text", access: locked },
        { name: "location", type: "point", access: locked },
        { name: "landmarkPhoto", type: "upload", relationTo: "private-media", access: locked },
      ],
    },
    { name: "riderNotes", type: "textarea", maxLength: 500, access: locked },
    {
      // Estimated delivery fee at checkout (cash to the rider; DigiMall never handles it)
      name: "fare",
      type: "group",
      fields: [
        { name: "estimate", label: "Estimated fee (₱)", type: "number", access: locked },
        { name: "base", type: "number", access: locked },
        { name: "extraStops", type: "number", access: locked },
        { name: "extraStopFee", type: "number", access: locked },
      ],
    },
    // ---- Paid-but-unbooked timers (Phase 7, CLAUDE.md §8 decided rule) ----
    { name: "readyToBookAt", label: "Every store paid at", type: "date", access: locked },
    { name: "bookingReminderAt", label: "Booking reminder sent at", type: "date", access: locked },
    { name: "selfPickupAt", label: "Became self-pickup at", type: "date", access: locked },
    // ---- Rider booking + trip (Phase 6, CLAUDE.md §11.7) ----
    { name: "rider", label: "Assigned rider", type: "relationship", relationTo: "users", index: true, access: locked },
    {
      // The one pending request for this order (a rider has a few minutes to accept)
      name: "riderRequest",
      type: "group",
      fields: [
        { name: "rider", type: "relationship", relationTo: "users", index: true, access: locked },
        { name: "requestedAt", type: "date", access: locked },
        { name: "expiresAt", type: "date", access: locked },
        { name: "auto", label: "Auto-pick nearest", type: "checkbox", access: locked },
        // Riders who declined or didn't answer this order (auto-pick skips them)
        { name: "tried", type: "relationship", relationTo: "users", hasMany: true, access: locked },
      ],
    },
    {
      name: "trip",
      type: "group",
      fields: [
        { name: "acceptedAt", type: "date", access: locked },
        { name: "firstPickupAt", type: "date", access: locked },
        { name: "deliveredAt", type: "date", access: locked },
        { name: "feeCollected", label: "Cash fee collected (₱, confirmed by the rider)", type: "number", access: locked },
        { name: "conversation", label: "Trip chat", type: "relationship", relationTo: "conversations", access: locked },
      ],
    },
    {
      name: "cancel",
      type: "group",
      fields: [
        { name: "by", type: "select", options: ["buyer", "store", "system"], access: locked },
        { name: "reason", type: "text", access: locked },
        { name: "at", type: "date", access: locked },
        // Where the order was when it was cancelled (for rider compensation per the Terms, CLAUDE.md §11.8)
        { name: "stage", type: "text", access: locked },
      ],
    },
  ],
};
