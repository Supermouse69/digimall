import type { CollectionConfig } from "payload";

import { superAdminOnly } from "@/lib/access";

export const AUDIT_ACTIONS = [
  "private_file.viewed",
  "invite.sent",
  "invite.accepted",
  "rider.status_changed",
  "user.role_changed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Security/privacy trail (CLAUDE.md §9, §10.12). Written only by server code; nobody can edit
// or delete entries through the API or the admin panel — not even the super-admin.
export const AuditLogs: CollectionConfig = {
  slug: "audit-logs",
  labels: { singular: "Audit log entry", plural: "Audit log" },
  access: {
    read: superAdminOnly,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  admin: {
    useAsTitle: "action",
    defaultColumns: ["createdAt", "action", "actor", "targetCollection", "targetId"],
    hidden: ({ user }) => (user as { role?: string } | null)?.role !== "super-admin",
  },
  timestamps: true,
  fields: [
    { name: "action", type: "select", required: true, index: true, options: [...AUDIT_ACTIONS] },
    { name: "actor", type: "relationship", relationTo: "users", index: true },
    { name: "targetCollection", type: "text" },
    { name: "targetId", type: "text", index: true },
    { name: "details", type: "json" },
    { name: "ip", label: "IP address", type: "text" },
  ],
};
