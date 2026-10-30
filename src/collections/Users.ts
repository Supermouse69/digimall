import type { CollectionConfig, PayloadRequest } from 'payload'
import { tenantsArrayField } from "@payloadcms/plugin-multi-tenant/fields";

import { LEGAL_PAGE_SLUGS } from "@/collections/LegalPages";
import { fromPoint, isValidLatLng } from "@/lib/geo";
import { isPhMobile, normalizePhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";
import { getSettings, isInServiceArea } from "@/modules/settings/server/settings";
import { resetPasswordTemplate, verifyEmailTemplate } from "@/modules/email/templates";
import { ownPrivateFile } from "@/lib/private-files";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

import {
  canUseAdminPanel,
  isSuperAdmin,
  superAdminOnly,
  superAdminOnlyField,
  superAdminOrSelf,
} from "@/lib/access";
import { USER_ROLES } from "@/modules/auth/roles";

// Only the super-admin can attach a user to a store.
const defaultTenantArrayField = tenantsArrayField({
  tenantsArrayFieldName: "tenants",
  tenantsCollectionSlug: "tenants",
  tenantsArrayTenantFieldName: "tenant",
  arrayFieldAccess: {
    read: () => true,
    create: superAdminOnlyField,
    update: superAdminOnlyField,
  },
  tenantFieldAccess: {
    read: () => true,
    create: superAdminOnlyField,
    update: superAdminOnlyField,
  },
})

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    // Payload admin panel: sellers and the super-admin only
    admin: ({ req }) => canUseAdminPanel(req.user),
    read: superAdminOrSelf,
    // Public sign-up goes through our own server code (tRPC), not the REST API
    create: superAdminOnly,
    update: superAdminOrSelf,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role'],
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  auth: {
    cookies: {
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    },
    // New accounts must confirm their email before logging in. Payload only blocks accounts
    // marked unverified, so accounts created before this existed keep working.
    verify: {
      generateEmailSubject: () => verifyEmailTemplate({ token: "" }).subject,
      generateEmailHTML: ({ token, user }) => verifyEmailTemplate({ name: user?.name, token }).html,
    },
    forgotPassword: {
      expiration: 60 * 60 * 1000, // 1 hour
      generateEmailSubject: () => resetPasswordTemplate({ token: "" }).subject,
      generateEmailHTML: (args) =>
        resetPasswordTemplate({ name: args?.user?.name, token: args?.token ?? "" }).html,
    },
  },
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        if (operation === "update" && previousDoc?.role && previousDoc.role !== doc.role) {
          await writeAuditLog(req, {
            action: "user.role_changed",
            targetCollection: "users",
            targetId: doc.id,
            details: { from: previousDoc.role, to: doc.role },
          });
        }
        return doc;
      },
    ],
  },
  fields: [
    {
      name: "name",
      label: "Full name",
      type: "text",
      required: true,
      maxLength: 100,
    },
    {
      // Beta: one role per account (a store owner who wants to shop uses a separate buyer account)
      name: "role",
      type: "select",
      required: true,
      defaultValue: "buyer",
      options: USER_ROLES.map((role) => ({ label: role, value: role })),
      admin: {
        position: "sidebar",
      },
      access: {
        create: superAdminOnlyField,
        update: superAdminOnlyField,
      },
    },
    {
      ...defaultTenantArrayField,
      admin: {
        ...(defaultTenantArrayField?.admin || {}),
        position: "sidebar",
        description: "Sellers only: the store this account manages.",
      },
    },
    {
      name: "phone",
      label: "Mobile number",
      type: "text",
      maxLength: 20,
      validate: (value: string | null | undefined) =>
        !value || isPhMobile(value) ? true : PH_MOBILE_HINT,
      hooks: {
        beforeChange: [({ value }) => (typeof value === "string" && value ? normalizePhMobile(value) : value)],
      },
    },
    {
      // Buyer delivery details. Sellers see only the barangay on orders; riders see the rest only
      // during an active trip (CLAUDE.md §10 table) — enforced in the order/trip code later.
      name: "buyerProfile",
      label: "Delivery address",
      type: "group",
      admin: {
        condition: (data) => data?.role === "buyer",
      },
      fields: [
        {
          name: "barangay",
          type: "text",
          maxLength: 60,
          validate: async (value: string | null | undefined, { req }: { req: PayloadRequest }) => {
            if (!value) return true;
            const { barangays } = await getSettings(req.payload);
            return barangays.includes(value) ? true : "Pick a barangay from our service area.";
          },
        },
        {
          name: "addressDetails",
          label: "Street / purok / house details",
          type: "text",
          maxLength: 200,
        },
        {
          // Optional photo of the gate/landmark to help riders find the house. Private file.
          name: "landmarkPhoto",
          label: "Landmark photo (optional)",
          type: "upload",
          relationTo: "private-media",
          validate: ownPrivateFile("landmark"),
        },
        {
          name: "location",
          label: "Map pin",
          type: "point",
          validate: async (value: unknown, { req }: { req: PayloadRequest }) => {
            if (value === null || value === undefined) return true;
            const point = fromPoint(value as [number, number]);
            if (!isValidLatLng(point)) return "Invalid map pin.";
            const settings = await getSettings(req.payload);
            return isInServiceArea(settings, point) ? true : "This pin is outside our delivery area.";
          },
        },
      ],
    },
    {
      // Which legal documents (and versions) this user agreed to, and when.
      // Written only by our server code — users can't edit their own consent records.
      name: "consents",
      type: "array",
      access: {
        create: superAdminOnlyField,
        update: superAdminOnlyField,
      },
      admin: {
        readOnly: true,
        position: "sidebar",
      },
      fields: [
        { name: "document", type: "select", required: true, options: [...LEGAL_PAGE_SLUGS] },
        { name: "version", type: "number", required: true },
        { name: "acceptedAt", type: "date", required: true },
      ],
    },
    {
      // When we last emailed a verification link (to slow down "resend" spam). Server code only.
      name: "verificationSentAt",
      type: "date",
      access: {
        read: () => false,
        create: () => false,
        update: () => false,
      },
      admin: { hidden: true },
    },
    {
      name: "ageConfirmedAt",
      label: "Age confirmed at",
      type: "date",
      access: {
        create: superAdminOnlyField,
        update: superAdminOnlyField,
      },
      admin: {
        readOnly: true,
        position: "sidebar",
      },
    },
  ],
};
