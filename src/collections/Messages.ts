import type { CollectionConfig } from "payload";

import { isSuperAdmin } from "@/lib/access";

export const MESSAGE_KINDS = ["text", "image", "product_ref", "system", "order_card", "payment_receipt", "refund_request", "refund_qr", "refund_proof"] as const;
export const MESSAGE_SIDES = ["buyer", "store", "rider", "system"] as const;

const locked = { update: () => false };

// Chat messages. Like Conversations: no direct API use except the super-admin reading
// messages of a REPORTED chat. Order cards, receipts and refund messages come in Phases 5 and 7.
export const Messages: CollectionConfig = {
  slug: "messages",
  access: {
    read: ({ req }) => (isSuperAdmin(req.user) ? { "conversation.underReport": { equals: true } } : false),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  admin: {
    defaultColumns: ["conversation", "side", "kind", "text", "createdAt"],
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  fields: [
    { name: "conversation", type: "relationship", relationTo: "conversations", required: true, index: true, access: locked },
    { name: "side", type: "select", required: true, options: [...MESSAGE_SIDES], access: locked },
    { name: "sender", type: "relationship", relationTo: "users", access: locked },
    { name: "kind", type: "select", required: true, defaultValue: "text", options: [...MESSAGE_KINDS], access: locked },
    { name: "text", type: "textarea", maxLength: 2000, access: locked },
    { name: "image", type: "upload", relationTo: "private-media", access: locked },
    { name: "product", type: "relationship", relationTo: "products", access: locked },
    // Order cards + payment receipts point to their store order (Phase 5)
    { name: "storeOrder", type: "relationship", relationTo: "store-orders", access: locked },
    {
      // What the product looked like when it was sent (it may change or be hidden later)
      name: "productSnapshot",
      type: "group",
      fields: [
        { name: "name", type: "text", access: locked },
        { name: "price", type: "number", access: locked },
        { name: "storeSlug", type: "text", access: locked },
      ],
    },
  ],
  timestamps: true,
  indexes: [{ fields: ["conversation", "createdAt"] }],
};
