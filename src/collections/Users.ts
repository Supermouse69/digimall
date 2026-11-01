import { AuthenticationError, type CollectionConfig } from 'payload'
import { tenantsArrayField } from "@payloadcms/plugin-multi-tenant/fields";

import { LEGAL_PAGE_SLUGS } from "@/collections/LegalPages";
import { isPhMobile, normalizePhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";
import { validateServiceAreaPin, validateServiceBarangay } from "@/modules/settings/server/validators";
import { adminResetDisabledTemplate, resetPasswordTemplate, verifyEmailTemplate } from "@/modules/email/templates";
import { ownPrivateFile } from "@/lib/private-files";
import { writeAuditLog } from "@/modules/audit/server/audit-log";
import { clientIp } from "@/modules/bot-protection/server/client-ip";
import { enforceApiRateLimit, RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

import {
  canUseAdminPanel,
  isSuperAdmin,
  superAdminOnly,
  superAdminOnlyField,
  superAdminOrSelf,
} from "@/lib/access";
import { USER_ROLES } from "@/modules/auth/roles";
import { CHAT_NAME_HINT, isValidChatName } from "@/lib/chat-name";
import { eraseUser, exportUserData, PrivacyError } from "@/modules/privacy/server/privacy-service";

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
  // Privacy requests (CLAUDE.md §9): super-admin only, every use is audit-logged.
  //   GET  /api/users/<id>/privacy-export  -> the user's data as a JSON download
  //   POST /api/users/<id>/privacy-erase   -> erase/anonymize (body: { confirmEmail })
  endpoints: [
    {
      path: "/:id/privacy-export",
      method: "get",
      handler: async (req) => {
        if (!isSuperAdmin(req.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const id = String(req.routeParams?.id ?? "");
        const data = await exportUserData({ payload: req.payload }, id, req.user!.id as string).catch(() => null);
        if (!data) return Response.json({ error: "User not found" }, { status: 404 });
        return new Response(JSON.stringify(data, null, 2), {
          headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="digimall-data-${id}.json"`, "Cache-Control": "no-store" },
        });
      },
    },
    {
      path: "/:id/privacy-erase",
      method: "post",
      handler: async (req) => {
        if (!isSuperAdmin(req.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const id = String(req.routeParams?.id ?? "");
        const body = (await req.json?.().catch(() => null)) as { confirmEmail?: string } | null;
        const target = await req.payload.findByID({ collection: "users", id, depth: 0, overrideAccess: true }).catch(() => null);
        if (!target) return Response.json({ error: "User not found" }, { status: 404 });
        // Typing the email is the confirmation (erasing can't be undone)
        if (!body?.confirmEmail || body.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
          return Response.json({ error: "Type the user's email exactly to confirm." }, { status: 400 });
        }
        try {
          return Response.json(await eraseUser({ payload: req.payload }, id, req.user!.id as string));
        } catch (error) {
          return Response.json({ error: error instanceof PrivacyError ? error.message : "Couldn't erase this account." }, { status: 409 });
        }
      },
    },
  ],
  hooks: {
    // Rate limits for Payload's own REST endpoints (/api/users/login, /api/users/forgot-password),
    // which /admin/login uses. Without this a bot could skip our forms and hit the API directly.
    // Our own forms call Payload's local API (payloadAPI "local") and are limited in tRPC instead.
    beforeOperation: [
      async ({ args, operation, req }) => {
        if (req.payloadAPI !== "REST") return args;
        const ip = clientIp(req.headers);
        if (operation === "login") {
          await enforceApiRateLimit(req.payload, RATE_LIMITS.login, ip);
        }
        if (operation === "forgotPassword") {
          await enforceApiRateLimit(req.payload, RATE_LIMITS.forgotPasswordIp, ip);
          const email = (args as { data?: { email?: unknown } }).data?.email;
          if (typeof email === "string") await enforceApiRateLimit(req.payload, RATE_LIMITS.forgotPasswordEmail, email);
        }
        return args;
      },
    ],
    // Super-admins can ONLY log in through the hidden entry page with 2FA (it sets this flag).
    // This covers /login, Payload's own /admin/login, the REST API AND password reset links
    // (Payload runs this hook on reset too, and a refusal undoes the whole reset).
    // Same generic error, so nobody learns which emails are admin accounts.
    beforeLogin: [
      ({ user, context }) => {
        if ((user as { role?: string })?.role === "super-admin" && !context?.adminEntry) {
          throw new AuthenticationError();
        }
        // Erased accounts (privacy request) can never log in again
        if ((user as { deletedAt?: string | null })?.deletedAt) throw new AuthenticationError();
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
      // Optional; stores see this in chat instead of the buyer's name (else the first name only)
      name: "chatName",
      label: "Username (optional, shown to stores in chat)",
      type: "text",
      maxLength: 30,
      validate: (value: string | null | undefined) => (!value || isValidChatName(value) ? true : CHAT_NAME_HINT),
      admin: { condition: (data) => data?.role === "buyer" },
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
          validate: validateServiceBarangay,
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
          validate: validateServiceAreaPin,
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
      // Privacy requests (super-admin only): download the user's data / erase the account
      name: "privacyTools",
      type: "ui",
      admin: {
        position: "sidebar",
        condition: (data) => Boolean(data?.id),
        components: { Field: "/components/admin/privacy-tools#PrivacyTools" },
      },
    },
    {
      // Set when the account was erased (privacy request). Server code only.
      name: "deletedAt",
      label: "Erased at (privacy request)",
      type: "date",
      access: { create: () => false, update: () => false },
      admin: { position: "sidebar", readOnly: true, condition: (data) => Boolean(data?.deletedAt) },
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
