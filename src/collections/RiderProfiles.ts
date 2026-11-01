import type { Access, CollectionConfig, Where } from "payload";

import { isSuperAdmin, superAdminOnly, superAdminOnlyField } from "@/lib/access";
import { ownPrivateFile, relationId } from "@/lib/private-files";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

export const RIDER_STATUSES = ["pending", "approved", "suspended"] as const;

const superAdminOrOwnProfile: Access = ({ req }) => {
  if (isSuperAdmin(req.user)) return true;
  if (!req.user || req.user.collection !== "users") return false;
  return { user: { equals: req.user.id } } satisfies Where;
};

const DOCUMENT_FIELDS = ["licenseDocument", "franchiseDocument"] as const;

// Tricycle riders (CLAUDE.md §8, §9): an approved LTO license + LGU franchise (MTOP) are required.
// Riders are created by the super-admin through an invite; they can't approve themselves.
export const RiderProfiles: CollectionConfig = {
  slug: "rider-profiles",
  labels: { singular: "Rider", plural: "Riders" },
  access: {
    read: superAdminOrOwnProfile,
    create: superAdminOnly,
    update: superAdminOrOwnProfile,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "displayName",
    defaultColumns: ["displayName", "status", "user", "updatedAt"],
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, operation, req }) => {
        // If a rider replaces a license/franchise document after approval, the super-admin
        // must check it again (same idea as GCash QR re-approval).
        if (
          operation === "update" &&
          !isSuperAdmin(req.user) &&
          originalDoc?.status === "approved" &&
          DOCUMENT_FIELDS.some(
            (field) => field in data && relationId(data[field]) !== relationId(originalDoc[field]),
          )
        ) {
          return { ...data, status: "pending" };
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        if (operation === "update" && previousDoc?.status !== doc.status) {
          await writeAuditLog(req, {
            action: "rider.status_changed",
            targetCollection: "rider-profiles",
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
      name: "user",
      type: "relationship",
      relationTo: "users",
      required: true,
      unique: true,
      access: { update: () => false },
      admin: { readOnly: true },
    },
    { name: "displayName", label: "Display name", type: "text", required: true, maxLength: 60 },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "pending",
      options: [...RIDER_STATUSES],
      access: { create: superAdminOnlyField, update: superAdminOnlyField },
      admin: {
        position: "sidebar",
        description: "Approve only after checking the license and MTOP documents.",
      },
    },
    {
      name: "photo",
      type: "upload",
      relationTo: "private-media",
      validate: ownPrivateFile("rider-photo"),
    },
    {
      name: "licenseDocument",
      label: "Driver's license (LTO)",
      type: "upload",
      relationTo: "private-media",
      validate: ownPrivateFile("rider-license"),
    },
    {
      name: "franchiseDocument",
      label: "Tricycle franchise / permit (MTOP)",
      type: "upload",
      relationTo: "private-media",
      validate: ownPrivateFile("rider-franchise"),
    },
    {
      name: "todaName",
      label: "TODA (optional)",
      type: "text",
      maxLength: 100,
    },
    {
      // Riders turn this on in the rider portal (Phase 6). Only approved riders can be Active.
      name: "isActive",
      label: "Active",
      type: "checkbox",
      defaultValue: false,
      access: { create: superAdminOnlyField, update: superAdminOnlyField },
      admin: { position: "sidebar", description: "Riders switch this in the rider portal (approved riders only)." },
    },
    {
      // Only the LATEST point, and only while Active (CLAUDE.md §9, §11.13). Cleared when the
      // rider goes off Active. No location history is kept.
      name: "lastLocation",
      type: "group",
      access: { create: () => false, update: () => false },
      admin: { readOnly: true, position: "sidebar" },
      fields: [
        { name: "lat", type: "number" },
        { name: "lng", type: "number" },
        { name: "at", type: "date" },
      ],
    },
  ],
};
