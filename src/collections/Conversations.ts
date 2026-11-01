import type { Access, CollectionConfig } from "payload";

import { isSuperAdmin, superAdminOnlyField } from "@/lib/access";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

// Super-admin: only chats that were reported (CLAUDE.md §10 table: "Reports/disputes only, logged").
// Buyers and sellers never use the API directly: our chat server code checks membership.
export const superAdminReportedOnly: Access = ({ req }) => (isSuperAdmin(req.user) ? { underReport: { equals: true } } : false);

const locked = { update: () => false };

// One chat thread. Store chats: one per buyer + store pair (CLAUDE.md §11.3).
// Trip chats (buyer + rider) come in Phase 6 and reuse this collection.
export const Conversations: CollectionConfig = {
  slug: "conversations",
  labels: { singular: "Chat", plural: "Chats" },
  access: {
    read: superAdminReportedOnly,
    create: () => false,
    // The super-admin can only untick "under report" after resolving the report
    update: superAdminReportedOnly,
    delete: () => false,
  },
  admin: {
    useAsTitle: "threadKey",
    defaultColumns: ["type", "buyer", "tenant", "lastMessageAt", "underReport"],
    hidden: ({ user }) => !isSuperAdmin(user),
    description: "Only reported chats are listed here. Opening one is recorded in the audit log.",
  },
  hooks: {
    afterRead: [
      async ({ doc, req, findMany }) => {
        if (!findMany && req.user && isSuperAdmin(req.user) && req.payloadAPI !== "local") {
          await writeAuditLog(req, { action: "chat.viewed", targetCollection: "conversations", targetId: doc.id });
        }
        return doc;
      },
    ],
  },
  fields: [
    // "store:<buyerId>:<storeId>" (later "trip:<orderId>"): makes the one-thread-per-pair rule a unique index
    { name: "threadKey", type: "text", required: true, unique: true, index: true, access: locked, admin: { readOnly: true } },
    { name: "type", type: "select", required: true, defaultValue: "store", options: ["store", "trip"], access: locked },
    { name: "buyer", type: "relationship", relationTo: "users", required: true, index: true, access: locked },
    { name: "tenant", label: "Store", type: "relationship", relationTo: "tenants", index: true, access: locked },
    // Trip chats (Phase 6): the assigned rider + the order. Read-only once the trip ends (closedAt).
    { name: "rider", type: "relationship", relationTo: "users", index: true, access: locked },
    { name: "order", type: "relationship", relationTo: "orders", access: locked },
    { name: "closedAt", label: "Trip ended at (chat is read-only)", type: "date", access: locked },
    { name: "lastMessageAt", type: "date", index: true, access: locked },
    { name: "lastMessagePreview", type: "text", maxLength: 120, access: locked },
    { name: "lastSenderSide", type: "select", options: ["buyer", "store", "rider", "system"], access: locked },
    { name: "buyerLastReadAt", type: "date", access: locked, admin: { hidden: true } },
    { name: "storeLastReadAt", type: "date", access: locked, admin: { hidden: true } },
    { name: "riderLastReadAt", type: "date", access: locked, admin: { hidden: true } },
    // Lazy expiry (CLAUDE.md §11.6): messages are hidden after this and deleted by the cleanup job
    { name: "deleteAfter", type: "date", index: true, access: locked },
    {
      name: "underReport",
      type: "checkbox",
      defaultValue: false,
      index: true,
      access: { update: superAdminOnlyField },
      admin: { description: "Kept (not auto-deleted) while ticked. Untick after the report is resolved." },
    },
  ],
};
