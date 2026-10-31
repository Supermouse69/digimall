import type { Access, CollectionConfig, Where } from "payload";

import {
  getUserTenantIds,
  isSuperAdmin,
  PUBLIC_STORE_STATUSES,
  superAdminOnlyField,
  superAdminOrOwnTenant,
  superAdminOrStoreMember,
} from "@/lib/access";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

// Public: products the admin hasn't hidden, from approved stores only. Sellers also see all of
// their own products. Super-admin: everything.
const readProducts: Access = ({ req }) => {
  if (isSuperAdmin(req.user)) return true;
  const visible: Where = {
    and: [{ isHidden: { not_equals: true } }, { "tenant.status": { in: [...PUBLIC_STORE_STATUSES] } }],
  };
  const ownIds = getUserTenantIds(req.user);
  return ownIds.length > 0 ? { or: [visible, { tenant: { in: ownIds } }] } : visible;
};

export const Products: CollectionConfig = {
  slug: "products",
  access: {
    read: readProducts,
    create: superAdminOrStoreMember,
    update: superAdminOrOwnTenant("tenant"),
    delete: superAdminOrOwnTenant("tenant"),
  },
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "price", "isAvailable", "category", "isHidden"],
  },
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        if (operation === "update" && Boolean(previousDoc?.isHidden) !== Boolean(doc.isHidden)) {
          await writeAuditLog(req, {
            action: "product.visibility_changed",
            targetCollection: "products",
            targetId: doc.id,
            details: { hidden: Boolean(doc.isHidden), reason: doc.hiddenReason ?? undefined },
          });
        }
        return doc;
      },
    ],
  },
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
      maxLength: 120,
    },
    {
      name: "description",
      type: "textarea",
      maxLength: 2000,
    },
    {
      // Whole pesos only (CLAUDE.md §12): no decimals, so every total and refund is exact
      name: "price",
      label: "Price (₱, whole pesos)",
      type: "number",
      required: true,
      min: 1,
      max: 1_000_000,
      admin: { step: 1, description: "Whole pesos only, e.g. 25 (not 24.50)." },
      validate: (value: number | null | undefined) =>
        typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000
          ? true
          : "Use a whole number of pesos, from ₱1 to ₱1,000,000.",
    },
    {
      // Only categories the super-admin created (the whitelist keeps prohibited items out)
      name: "category",
      type: "relationship",
      relationTo: "categories",
      hasMany: false,
      required: true,
    },
    {
      name: "image",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "cover",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "isAvailable",
      label: "Available",
      type: "checkbox",
      defaultValue: true,
      admin: {
        position: "sidebar",
        description: "Untick when you don't have it right now. Buyers see \"Not available\".",
      },
    },
    {
      name: "isHidden",
      label: "Hidden by admin",
      type: "checkbox",
      defaultValue: false,
      access: { create: superAdminOnlyField, update: superAdminOnlyField },
      admin: {
        position: "sidebar",
        description: "Super-admin only: takes the product off the site (e.g. a prohibited item or a report).",
      },
    },
    {
      name: "hiddenReason",
      label: "Why it was hidden",
      type: "text",
      maxLength: 300,
      access: { create: superAdminOnlyField, update: superAdminOnlyField },
      admin: {
        position: "sidebar",
        condition: (data) => Boolean(data?.isHidden),
        description: "The seller can see this.",
      },
    },
  ],
};
