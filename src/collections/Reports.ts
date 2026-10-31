import type { CollectionConfig } from "payload";

import { isSuperAdmin, superAdminOnly } from "@/lib/access";
import { writeAuditLog } from "@/modules/audit/server/audit-log";
import { REPORT_REASONS, REPORT_TARGETS } from "@/modules/reports/reasons";

// Buyer reports (CLAUDE.md §9 Internet Transactions Act: complaints + takedown).
// Minimal beta version: logged-in users report a product or store; only the super-admin sees
// reports. Stores never see them or who reported. The full reports queue comes in Phase 8.
export const Reports: CollectionConfig = {
  slug: "reports",
  access: {
    read: superAdminOnly,
    // Created only by our server code (reports.create), which checks login + rate limits
    create: () => false,
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "reason",
    defaultColumns: ["status", "targetType", "reason", "product", "store", "createdAt"],
    hidden: ({ user }) => !isSuperAdmin(user),
    description: "What buyers reported. To act: hide the product or suspend the store, then mark this resolved.",
  },
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        if (operation === "update" && previousDoc?.status !== doc.status) {
          await writeAuditLog(req, {
            action: "report.status_changed",
            targetCollection: "reports",
            targetId: doc.id,
            details: { from: previousDoc?.status, to: doc.status },
          });
        }
        return doc;
      },
    ],
  },
  fields: [
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "open",
      options: ["open", "resolved", "dismissed"],
      admin: { position: "sidebar" },
    },
    { name: "targetType", label: "What was reported", type: "select", required: true, options: [...REPORT_TARGETS], access: { update: () => false } },
    { name: "product", type: "relationship", relationTo: "products", access: { update: () => false } },
    { name: "store", type: "relationship", relationTo: "tenants", access: { update: () => false } },
    {
      // Reported chats are kept (not auto-deleted) and become readable for the super-admin (logged)
      name: "conversation",
      label: "Chat",
      type: "relationship",
      relationTo: "conversations",
      access: { update: () => false },
    },
    {
      name: "reason",
      type: "select",
      required: true,
      options: REPORT_REASONS.map((reason) => ({ ...reason })),
      access: { update: () => false },
    },
    { name: "note", label: "Buyer's note", type: "textarea", maxLength: 500, access: { update: () => false } },
    { name: "reporter", type: "relationship", relationTo: "users", access: { update: () => false }, admin: { readOnly: true } },
    { name: "adminNote", label: "Your note (private)", type: "textarea", maxLength: 1000 },
  ],
};
