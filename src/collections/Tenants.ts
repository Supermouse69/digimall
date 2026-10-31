import type { Access, CollectionConfig, Where } from 'payload'

import {
  getUserTenantIds,
  isSuperAdmin,
  PUBLIC_STORE_STATUSES,
  superAdminOnly,
  superAdminOnlyField,
  superAdminOrOwnStoreField,
  superAdminOrOwnTenant,
} from "@/lib/access";
import { isPhMobile, normalizePhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";
import { ownPrivateFile, relationId } from "@/lib/private-files";
import { writeAuditLog } from "@/modules/audit/server/audit-log";
import { validateServiceAreaPin, validateServiceBarangay } from "@/modules/settings/server/validators";

export const STORE_STATUSES = ["pending", "unverified", "verified", "suspended"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

// Public: only approved stores (unverified/verified). Sellers also see their own store, whatever
// its status. Super-admin: everything.
const readStores: Access = ({ req }) => {
  if (isSuperAdmin(req.user)) return true;
  const visible: Where = { status: { in: [...PUBLIC_STORE_STATUSES] } };
  const ownIds = getUserTenantIds(req.user);
  return ownIds.length > 0 ? { or: [visible, { id: { in: ownIds } }] } : visible;
};

// Private: only the store's seller and the super-admin can see these (never the public API)
const privateField = { read: superAdminOrOwnStoreField };
const adminOnlyWrite = { create: superAdminOnlyField, update: superAdminOnlyField };

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  labels: { singular: "Store", plural: "Stores" },
  access: {
    read: readStores,
    // Stores are created only by the super-admin (CLAUDE.md §8)
    create: superAdminOnly,
    update: superAdminOrOwnTenant("id"),
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ["name", "slug", "status", "barangay", "gcashQrApproved"],
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        const next = { ...data };

        // GCash QR changed -> it must be approved again before buyers ever see it (prevents
        // QR-swap scams). Only the super-admin can approve, in the same save or later.
        const qrChanged = "gcashQr" in next && relationId(next.gcashQr) !== relationId(originalDoc?.gcashQr);
        if (qrChanged && !(isSuperAdmin(req.user) && next.gcashQrApproved === true && originalDoc?.gcashQrApproved !== true)) {
          next.gcashQrApproved = false;
        }
        const qr = "gcashQr" in next ? next.gcashQr : originalDoc?.gcashQr;
        if (!relationId(qr)) next.gcashQrApproved = false;

        // Record who verified the store, and when
        if (next.status === "verified" && originalDoc?.status !== "verified" && isSuperAdmin(req.user)) {
          next.verifiedAt = new Date().toISOString();
          next.verifiedBy = req.user!.id;
        }
        return next;
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        if (operation === "update" && previousDoc?.status !== doc.status) {
          await writeAuditLog(req, {
            action: "store.status_changed",
            targetCollection: "tenants",
            targetId: doc.id,
            details: { from: previousDoc?.status, to: doc.status },
          });
        }
        if (operation === "update" && Boolean(previousDoc?.gcashQrApproved) !== Boolean(doc.gcashQrApproved)) {
          await writeAuditLog(req, {
            action: "store.gcash_qr_approval_changed",
            targetCollection: "tenants",
            targetId: doc.id,
            details: { approved: Boolean(doc.gcashQrApproved) },
          });
        }
        return doc;
      },
    ],
  },
  fields: [
    {
      name: "name",
      required: true,
      type: "text",
      label: "Store name",
      maxLength: 80,
      admin: {
        description: "This is the name of the store (e.g. Aling Nena's Sari-Sari Store)",
      },
    },
    {
      name: "slug",
      type: "text",
      index: true,
      required: true,
      unique: true,
      access: {
        update: superAdminOnlyField,
      },
      admin: {
        description: "Used in the store's web address (/store/<slug>). Only the super-admin can change it.",
      },
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "pending",
      options: [
        { label: "Pending (hidden)", value: "pending" },
        { label: "Unverified store", value: "unverified" },
        { label: "Business permit checked", value: "verified" },
        { label: "Suspended (hidden)", value: "suspended" },
      ],
      access: adminOnlyWrite,
      admin: {
        position: "sidebar",
        description:
          "Pending and suspended stores are hidden from buyers. \"Business permit checked\" = you saw their Mayor's/business permit or barangay business clearance.",
      },
    },
    {
      name: "verifiedAt",
      type: "date",
      access: { ...adminOnlyWrite, ...privateField },
      admin: { position: "sidebar", readOnly: true },
    },
    {
      name: "verifiedBy",
      type: "relationship",
      relationTo: "users",
      access: { ...adminOnlyWrite, ...privateField },
      admin: { position: "sidebar", readOnly: true },
    },
    {
      type: "collapsible",
      label: "Store details (shown to buyers)",
      fields: [
        {
          name: "ownerName",
          label: "Owner or business name (as written on the permit)",
          type: "text",
          maxLength: 120,
        },
        { name: "description", type: "textarea", maxLength: 1000 },
        {
          name: "barangay",
          type: "text",
          maxLength: 60,
          validate: validateServiceBarangay,
          admin: { description: "Must be one of the barangays in Settings." },
        },
        {
          name: "addressDetails",
          label: "Street / purok (general address)",
          type: "text",
          maxLength: 200,
        },
        {
          name: "location",
          label: "Map pin",
          type: "point",
          validate: validateServiceAreaPin,
          admin: { description: "Longitude, latitude. Must be inside the delivery area." },
        },
        { name: "hours", label: "Opening hours", type: "text", maxLength: 100, admin: { placeholder: "e.g. 7 AM – 9 PM daily" } },
        { name: "logo", type: "upload", relationTo: "media" },
        { name: "banner", type: "upload", relationTo: "media" },
      ],
    },
    {
      type: "collapsible",
      label: "Private (only you and the super-admin)",
      fields: [
        {
          name: "phone",
          label: "Store mobile number",
          type: "text",
          access: privateField,
          validate: (value: string | null | undefined) => (!value || isPhMobile(value) ? true : PH_MOBILE_HINT),
          hooks: {
            beforeChange: [({ value }) => (typeof value === "string" && value ? normalizePhMobile(value) : value)],
          },
          admin: { description: "Buyers never see this (they use chat). Riders see it during a trip." },
        },
        {
          name: "gcashQr",
          label: "GCash QR code",
          type: "upload",
          relationTo: "private-media",
          access: privateField,
          validate: ownPrivateFile("store-gcash-qr"),
          admin: { description: "Upload as a private file with purpose \"store-gcash-qr\". Changing it needs the super-admin's approval again." },
        },
        {
          name: "gcashQrApproved",
          label: "GCash QR approved",
          type: "checkbox",
          defaultValue: false,
          access: { ...adminOnlyWrite, ...privateField },
          admin: { description: "Super-admin only. Turns off by itself when the QR changes." },
        },
        {
          name: "businessPermit",
          label: "Mayor's/business permit or barangay business clearance",
          type: "upload",
          relationTo: "private-media",
          access: privateField,
          validate: ownPrivateFile("store-permit"),
        },
        {
          name: "birCertificate",
          label: "BIR Form 2303 (optional during beta)",
          type: "upload",
          relationTo: "private-media",
          access: privateField,
          validate: ownPrivateFile("store-bir"),
        },
        {
          name: "dtiSecRegistration",
          label: "DTI / SEC registration (optional during beta)",
          type: "upload",
          relationTo: "private-media",
          access: privateField,
          validate: ownPrivateFile("store-dti-sec"),
        },
      ],
    },
  ],
};
