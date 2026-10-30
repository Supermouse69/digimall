import { randomBytes } from "crypto";
import type { CollectionAfterChangeHook, CollectionConfig, PayloadRequest } from "payload";

import { isSuperAdmin, superAdminOnly } from "@/lib/access";
import { relationId } from "@/lib/private-files";
import { INVITE_LINK_DAYS, inviteTemplate } from "@/modules/email/templates";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

export const INVITE_ROLES = ["seller", "rider"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

const SKIP_INVITE_HOOK = "skipInviteHook";

// Makes a fresh "set your password" link and emails it. The password itself is never
// chosen, seen, or sent by the super-admin (CLAUDE.md §8).
const sendInviteEmail = async (
  req: PayloadRequest,
  invite: { email: string; name: string; role: InviteRole; store?: unknown },
) => {
  const token = await req.payload.forgotPassword({
    collection: "users",
    data: { email: invite.email },
    disableEmail: true,
    expiration: INVITE_LINK_DAYS * 24 * 60 * 60 * 1000,
    req,
  });
  if (!token) throw new Error("Could not create the invite link.");

  let storeName: string | null = null;
  const storeId = relationId(invite.store);
  if (storeId) {
    const store = await req.payload
      .findByID({ collection: "tenants", id: storeId, depth: 0, req })
      .catch(() => null);
    storeName = store?.name ?? null;
  }

  const { subject, html } = inviteTemplate({ name: invite.name, role: invite.role, storeName, token });
  await req.payload.sendEmail({ to: invite.email, subject, html });
};

const handleInvite: CollectionAfterChangeHook = async ({ doc, operation, req, context }) => {
  if (context?.[SKIP_INVITE_HOOK]) return doc;
  const now = new Date().toISOString();

  if (operation === "create") {
    // 1. The account, already email-confirmed (the invite link itself proves the email).
    //    Random password nobody knows; the person sets their own through the link.
    const user = await req.payload.create({
      collection: "users",
      data: {
        email: doc.email,
        name: doc.name,
        role: doc.role,
        password: randomBytes(32).toString("base64url"),
        _verified: true,
        tenants: doc.role === "seller" && doc.store ? [{ tenant: relationId(doc.store)! }] : [],
      },
      disableVerificationEmail: true,
      overrideAccess: true,
      req,
    });

    // 2. Riders get a profile that stays "pending" until the super-admin approves it
    if (doc.role === "rider") {
      await req.payload.create({
        collection: "rider-profiles",
        data: { user: user.id, displayName: doc.name, status: "pending" },
        overrideAccess: true,
        req,
      });
    }

    // 3. The email with the "set your password" link
    await sendInviteEmail(req, doc);

    await req.payload.update({
      collection: "invites",
      id: doc.id,
      data: { user: user.id, status: "sent", sentAt: now },
      context: { [SKIP_INVITE_HOOK]: true },
      overrideAccess: true,
      req,
    });
    await writeAuditLog(req, {
      action: "invite.sent",
      targetCollection: "users",
      targetId: user.id,
      details: { role: doc.role, store: relationId(doc.store) },
    });
    return { ...doc, user: user.id, status: "sent", sentAt: now };
  }

  // "Send again" ticked: new link, then untick
  if (operation === "update" && doc.resend && doc.status === "sent") {
    await sendInviteEmail(req, doc);
    await req.payload.update({
      collection: "invites",
      id: doc.id,
      data: { resend: false, sentAt: now },
      context: { [SKIP_INVITE_HOOK]: true },
      overrideAccess: true,
      req,
    });
    await writeAuditLog(req, {
      action: "invite.sent",
      targetCollection: "users",
      targetId: relationId(doc.user) ?? undefined,
      details: { role: doc.role, resend: true },
    });
    return { ...doc, resend: false, sentAt: now };
  }

  return doc;
};

// How sellers and riders get accounts (CLAUDE.md §8): the super-admin creates the store first,
// then an invite. Saving the invite creates the account and emails a "set your password" link.
export const Invites: CollectionConfig = {
  slug: "invites",
  labels: { singular: "Invite", plural: "Invites" },
  access: {
    read: superAdminOnly,
    create: superAdminOnly,
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "email",
    defaultColumns: ["email", "name", "role", "status", "sentAt"],
    description:
      "Invite a seller or rider. Create the seller's store first (Tenants), then pick it here. They get an email to set their own password.",
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  hooks: {
    beforeValidate: [
      ({ data }) => (data?.email ? { ...data, email: String(data.email).trim().toLowerCase() } : data),
    ],
    afterChange: [handleInvite],
  },
  fields: [
    {
      name: "email",
      type: "email",
      required: true,
      unique: true,
      access: { update: () => false },
      validate: async (value: string | null | undefined, { req, operation }: { req: PayloadRequest; operation?: string }) => {
        if (!value) return "Email is required.";
        if (operation !== "create") return true;
        const existing = await req.payload.find({
          collection: "users",
          where: { email: { equals: value.trim().toLowerCase() } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        return existing.docs.length > 0 ? "An account with this email already exists." : true;
      },
    },
    { name: "name", label: "Full name", type: "text", required: true, maxLength: 100, access: { update: () => false } },
    {
      name: "role",
      type: "select",
      required: true,
      options: [...INVITE_ROLES],
      access: { update: () => false },
    },
    {
      name: "store",
      type: "relationship",
      relationTo: "tenants",
      access: { update: () => false },
      admin: {
        condition: (data) => data?.role === "seller",
        description: "The store this seller will manage.",
      },
      validate: (value: unknown, { siblingData }: { siblingData: { role?: string } }) =>
        siblingData?.role === "seller" && !value ? "Pick the seller's store." : true,
    },
    {
      name: "resend",
      label: "Send the invite email again",
      type: "checkbox",
      defaultValue: false,
      admin: {
        position: "sidebar",
        condition: (data) => data?.status === "sent",
        description: "Tick and save to email a fresh link (the old link stops working).",
      },
    },
    {
      name: "status",
      type: "select",
      defaultValue: "pending",
      options: ["pending", "sent", "accepted"],
      admin: { position: "sidebar", readOnly: true },
    },
    { name: "user", type: "relationship", relationTo: "users", admin: { position: "sidebar", readOnly: true } },
    { name: "sentAt", type: "date", admin: { position: "sidebar", readOnly: true } },
    { name: "acceptedAt", type: "date", admin: { position: "sidebar", readOnly: true } },
  ],
};
