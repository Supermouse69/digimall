import { AuthenticationError, type CollectionConfig, type PayloadRequest } from 'payload'
import { tenantsArrayField } from "@payloadcms/plugin-multi-tenant/fields";

import { LEGAL_PAGE_SLUGS } from "@/collections/LegalPages";
import { fromPoint, isValidLatLng } from "@/lib/geo";
import { isPhMobile, normalizePhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";
import { getSettings, isInServiceArea } from "@/modules/settings/server/settings";
import { adminResetDisabledTemplate, resetPasswordTemplate, verifyEmailTemplate } from "@/modules/email/templates";
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
      // Super-admins can't reset by email (it would get around 2FA, and the reset is refused anyway).
      // They get a "resets are off" email instead; the web response looks the same for everyone.
      generateEmailSubject: (args) =>
        args?.user?.role === "super-admin"
          ? adminResetDisabledTemplate().subject
          : resetPasswordTemplate({ token: "" }).subject,
      generateEmailHTML: (args) =>
        args?.user?.role === "super-admin"
          ? adminResetDisabledTemplate().html
          : resetPasswordTemplate({ name: args?.user?.name, token: args?.token ?? "" }).html,
    },
  },
  hooks: {
    // Super-admins can ONLY log in through the hidden entry page with 2FA (it sets this flag).
    // This covers /login, Payload's own /admin/login, the REST API AND password reset links
    // (Payload runs this hook on reset too, and a refusal undoes the whole reset).
    // Same generic error, so nobody learns which emails are admin accounts.
    beforeLogin: [
      ({ user, context }) => {
        if ((user as { role?: string })?.role === "super-admin" && !context?.adminEntry) {
          throw new AuthenticationError();
        }
        return user;
      },
    ],
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
      // Super-admin 2FA. Hidden from every API response and the admin panel; only server code
      // (the hidden entry page) reads or writes it. The secret is encrypted at rest.
      name: "twoFactor",
      type: "group",
      hidden: true,
      access: {
        read: () => false,
        create: () => false,
        update: () => false,
      },
      // Each field is hidden too (Payload doesn't hide a group's children from the group alone)
      fields: [
        { name: "enabled", type: "checkbox", defaultValue: false, hidden: true },
        { name: "secret", type: "text", hidden: true },
        { name: "pendingSecret", type: "text", hidden: true },
        { name: "backupCodeHashes", type: "json", hidden: true },
        { name: "lastUsedStep", type: "number", hidden: true },
        { name: "failedAttempts", type: "number", defaultValue: 0, hidden: true },
        { name: "lockedUntil", type: "date", hidden: true },
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
