import type { CollectionConfig } from "payload";

import { isSuperAdmin } from "@/lib/access";

// Browser push subscriptions (CLAUDE.md §11.12). One row per device/browser that turned on
// notifications. Closed to the API: our server code adds/removes them for the logged-in user.
export const PushSubscriptions: CollectionConfig = {
  slug: "push-subscriptions",
  access: {
    read: ({ req }) => isSuperAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  admin: { hidden: ({ user }) => !isSuperAdmin(user), defaultColumns: ["user", "createdAt"] },
  fields: [
    { name: "user", type: "relationship", relationTo: "users", required: true, index: true, access: { update: () => false } },
    { name: "endpoint", type: "text", required: true, unique: true, access: { update: () => false } },
    { name: "p256dh", type: "text", required: true, access: { update: () => false } },
    { name: "auth", type: "text", required: true, access: { update: () => false } },
  ],
};
