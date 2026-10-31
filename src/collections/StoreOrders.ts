import type { CollectionConfig } from "payload";

import { isSuperAdmin, superAdminOnly } from "@/lib/access";
import { STORE_ORDER_STATUSES } from "@/modules/orders/state";

const locked = { update: () => false };

// The part of an order for ONE store (DM-XXXX-A). Items, prices and quantities are a snapshot
// taken at checkout. Closed to the API like Orders.
export const StoreOrders: CollectionConfig = {
  slug: "store-orders",
  labels: { singular: "Store order", plural: "Store orders" },
  access: {
    read: superAdminOnly,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  admin: {
    useAsTitle: "code",
    defaultColumns: ["code", "status", "tenant", "subtotal", "createdAt"],
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  fields: [
    { name: "code", type: "text", required: true, unique: true, index: true, access: locked },
    { name: "order", type: "relationship", relationTo: "orders", required: true, index: true, access: locked },
    { name: "suffix", type: "text", required: true, access: locked },
    { name: "tenant", label: "Store", type: "relationship", relationTo: "tenants", required: true, index: true, access: locked },
    { name: "buyer", type: "relationship", relationTo: "users", required: true, index: true, access: locked },
    { name: "conversation", label: "Store chat", type: "relationship", relationTo: "conversations", access: locked },
    {
      name: "items",
      type: "array",
      access: locked,
      fields: [
        { name: "product", type: "relationship", relationTo: "products", access: locked },
        { name: "name", type: "text", required: true, access: locked },
        { name: "price", label: "Price (₱)", type: "number", required: true, access: locked },
        { name: "qty", type: "number", required: true, access: locked },
      ],
    },
    { name: "subtotal", label: "Subtotal (₱)", type: "number", required: true, access: locked },
    { name: "status", type: "select", required: true, defaultValue: "awaiting_store", options: [...STORE_ORDER_STATUSES], index: true, access: locked },
    // Lazy timer (CLAUDE.md §11.6): checked on every read and action
    { name: "expiresAt", type: "date", index: true, access: locked },
    { name: "storeNotes", label: "Buyer's note to the store", type: "textarea", maxLength: 500, access: locked },
    {
      name: "payment",
      type: "group",
      fields: [
        { name: "method", type: "select", defaultValue: "gcash_manual", options: ["gcash_manual"], access: locked },
        { name: "receipt", type: "upload", relationTo: "private-media", access: locked },
        { name: "referenceNo", label: "GCash reference no.", type: "text", maxLength: 40, access: locked },
        { name: "submittedAt", type: "date", access: locked },
        { name: "confirmedAt", type: "date", access: locked },
        { name: "notReceivedAt", label: "Store said 'not received' at", type: "date", access: locked },
      ],
    },
    { name: "confirmedAt", label: "Store confirmed at", type: "date", access: locked },
    {
      name: "cancel",
      type: "group",
      fields: [
        { name: "by", type: "select", options: ["buyer", "store", "system"], access: locked },
        { name: "reason", type: "text", maxLength: 300, access: locked },
        { name: "at", type: "date", access: locked },
      ],
    },
  ],
};
