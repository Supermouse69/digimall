import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";
import { UnverifiedEmail, type Payload } from "payload";

import { baseProcedure, createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { getUserTenantIds } from "@/lib/access";
import { toPoint } from "@/lib/geo";
import { normalizePhMobile } from "@/lib/ph-phone";
import type { User } from "@/payload-types";
import {
  consentRecords,
  getLegalDocuments,
  needsConsent,
  REQUIRED_DOCUMENTS,
} from "@/modules/legal/server/consents";
import { getSettings, isInServiceArea } from "@/modules/settings/server/settings";
import { verifyEmailTemplate } from "@/modules/email/templates";
import { guardPublicForm, humanCheckInput } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

import { generateAuthCookie } from "../utils";
import { homeForRole, type UserRole } from "../roles";
import {
  acceptConsentsSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../schemas";

const RESEND_VERIFICATION_COOLDOWN_MS = 60 * 1000;

// Where to go right after logging in: the role's home, but /consent first if the user
// hasn't agreed to the current Terms/Privacy for their role (sellers and riders included).
const redirectAfterLogin = async (
  payload: Payload,
  user: Pick<User, "role" | "consents"> | undefined,
  next?: string | null,
): Promise<string> => {
  const home = homeForRole(user?.role, next);
  if (!user) return home;
  const documents = await getLegalDocuments(payload, REQUIRED_DOCUMENTS[user.role]);
  return needsConsent(user, documents) ? `/consent?next=${encodeURIComponent(home)}` : home;
};

// What the browser is allowed to know about the logged-in user. Never send the whole user document.
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  store: { slug: string; name: string } | null;
  // True when a Terms/Privacy version changed since the user last agreed
  needsConsent: boolean;
};

export const authRouter = createTRPCRouter({
  session: baseProcedure.query(async ({ ctx }): Promise<{ user: SessionUser | null }> => {
    const headers = await getHeaders();
    const { user } = await ctx.db.auth({ headers });

    if (!user || user.collection !== "users") return { user: null };
    const fullUser = user as User;

    let store: SessionUser["store"] = null;
    const tenantId = getUserTenantIds(fullUser)[0];
    if (tenantId) {
      const tenant = await ctx.db
        .findByID({ collection: "tenants", id: tenantId, depth: 0 })
        .catch(() => null);
      if (tenant) store = { slug: tenant.slug, name: tenant.name };
    }

    const currentDocs = await getLegalDocuments(ctx.db, REQUIRED_DOCUMENTS[fullUser.role]);

    return {
      user: {
        id: fullUser.id,
        name: fullUser.name,
        email: fullUser.email,
        role: fullUser.role,
        store,
        needsConsent: needsConsent(fullUser, currentDocs),
      },
    };
  }),

  register: baseProcedure
    .input(registerSchema.extend(humanCheckInput))
    .mutation(async ({ input, ctx }) => {
      await guardPublicForm(ctx.db, { turnstileToken: input.turnstileToken, limits: [{ rule: RATE_LIMITS.signup }] });

      // Public sign-up is for buyers only. Sellers and riders are created by the super-admin.
      const settings = await getSettings(ctx.db);
      if (!settings.barangays.includes(input.barangay)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a barangay from our service area." });
      }
      if (!isInServiceArea(settings, input.location)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your map pin is outside our delivery area." });
      }

      // Save exactly which document versions the buyer agreed to, and when
      const documents = await getLegalDocuments(ctx.db, REQUIRED_DOCUMENTS.buyer);
      if (documents.length !== REQUIRED_DOCUMENTS.buyer.length) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Sign-up is not available right now. Please try again later.",
        });
      }
      const now = new Date();

      try {
        await ctx.db.create({
          collection: "users",
          data: {
            name: input.name,
            email: input.email,
            phone: normalizePhMobile(input.phone),
            password: input.password, // This will be hashed
            role: "buyer",
            buyerProfile: {
              barangay: input.barangay,
              addressDetails: input.addressDetails,
              location: toPoint(input.location),
            },
            consents: consentRecords(documents, now),
            ageConfirmedAt: now.toISOString(),
            verificationSentAt: now.toISOString(),
          },
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not create account. The email may already be in use.",
        });
      }

      // Payload emailed a confirmation link. No login until the email is confirmed.
      return { verificationSent: true as const };
    }),

  // Confirms the email from the link we sent (/verify-email?token=...)
  verifyEmail: baseProcedure
    .input(verifyEmailSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.db.verifyEmail({ collection: "users", token: input.token });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This link is invalid or was already used.",
        });
      }
      return { verified: true as const };
    }),

  // Same answer whether or not the email has an account, so nobody can check who's registered.
  resendVerification: baseProcedure
    .input(emailOnlySchema.extend(humanCheckInput))
    .mutation(async ({ input, ctx }) => {
      await guardPublicForm(ctx.db, {
        turnstileToken: input.turnstileToken,
        limits: [{ rule: RATE_LIMITS.resendVerificationIp }],
      });

      const { docs } = await ctx.db.find({
        collection: "users",
        where: { email: { equals: input.email.toLowerCase() } },
        limit: 1,
        depth: 0,
        showHiddenFields: true,
      });
      const user = docs[0] as (User & { _verified?: boolean | null }) | undefined;

      if (user && user._verified === false) {
        const lastSent = user.verificationSentAt ? Date.parse(user.verificationSentAt) : 0;
        if (Date.now() - lastSent > RESEND_VERIFICATION_COOLDOWN_MS) {
          const token = randomBytes(20).toString("hex");
          // Database-level update: the token field is internal to Payload's auth
          await ctx.db.db.updateOne({
            collection: "users",
            id: user.id,
            data: { _verificationToken: token, verificationSentAt: new Date().toISOString() },
          });
          const { subject, html } = verifyEmailTemplate({ name: user.name, token });
          await ctx.db.sendEmail({ to: user.email, subject, html });
        }
      }

      return { success: true as const };
    }),

  // Same answer whether or not the email has an account (the limits are per IP AND per email).
  forgotPassword: baseProcedure
    .input(emailOnlySchema.extend(humanCheckInput))
    .mutation(async ({ input, ctx }) => {
      await guardPublicForm(ctx.db, {
        turnstileToken: input.turnstileToken,
        limits: [{ rule: RATE_LIMITS.forgotPasswordIp }, { rule: RATE_LIMITS.forgotPasswordEmail, key: input.email }],
      });

      try {
        await ctx.db.forgotPassword({ collection: "users", data: { email: input.email } });
      } catch {
        // Ignore: never reveal whether the email exists
      }
      return { success: true as const };
    }),

  // Sets the new password from the emailed link, then logs the user in
  resetPassword: baseProcedure
    .input(resetPasswordSchema)
    .mutation(async ({ input, ctx }) => {
      let token: string | undefined;
      let user: User | undefined;
      try {
        const result = await ctx.db.resetPassword({
          collection: "users",
          data: { token: input.token, password: input.password },
          overrideAccess: true,
        });
        token = result.token;
        user = result.user as unknown as User | undefined;
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This link is invalid or has expired. Please ask for a new one.",
        });
      }

      // Unverified buyers must still confirm their email before they can log in
      if (!token || (user as { _verified?: boolean | null } | undefined)?._verified === false) {
        return { redirectTo: "/login?reset=1" };
      }

      await generateAuthCookie({ prefix: ctx.db.config.cookiePrefix, value: token });

      // Setting a password from an invite = invite accepted
      if (user) {
        const { docs: invites } = await ctx.db.find({
          collection: "invites",
          where: { and: [{ user: { equals: user.id } }, { status: { equals: "sent" } }] },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const invite = invites[0];
        if (invite) {
          await ctx.db.update({
            collection: "invites",
            id: invite.id,
            data: { status: "accepted", acceptedAt: new Date().toISOString() },
            overrideAccess: true,
          });
          await ctx.db.create({
            collection: "audit-logs",
            overrideAccess: true,
            data: { action: "invite.accepted", actor: user.id, targetCollection: "users", targetId: user.id },
          });
        }
      }

      return { redirectTo: await redirectAfterLogin(ctx.db, user) };
    }),

  login: baseProcedure
    .input(loginSchema.extend(humanCheckInput))
    .mutation(async ({ input, ctx }) => {
      await guardPublicForm(ctx.db, { turnstileToken: input.turnstileToken, limits: [{ rule: RATE_LIMITS.login }] });

      let token: string | undefined;
      let loggedInUser: User | undefined;
      try {
        const data = await ctx.db.login({
          collection: "users",
          data: {
            email: input.email,
            password: input.password,
          },
        });
        token = data.token;
        loggedInUser = data.user as unknown as User | undefined;
      } catch (error) {
        // Payload only says "unverified" AFTER the password was correct, so this reveals nothing
        // to someone guessing emails.
        if (error instanceof UnverifiedEmail) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Please confirm your email first. Check your inbox for our link.",
          });
        }
        // Same message for every other failure so attackers can't tell which emails exist
        token = undefined;
      }

      if (!token) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Wrong email or password",
        });
      }

      await generateAuthCookie({
        prefix: ctx.db.config.cookiePrefix,
        value: token,
      });

      // The token lives only in the HttpOnly cookie; never send it to page JavaScript.
      // The redirect is only for convenience — every page still checks access on the server.
      return { redirectTo: await redirectAfterLogin(ctx.db, loggedInUser, input.next) };
    }),

  // Re-consent after the super-admin publishes a new Terms/Privacy version
  acceptConsents: protectedProcedure
    .input(acceptConsentsSchema)
    .mutation(async ({ ctx }) => {
      const documents = await getLegalDocuments(ctx.db, REQUIRED_DOCUMENTS[ctx.user.role]);
      await ctx.db.update({
        collection: "users",
        id: ctx.user.id,
        data: { consents: [...(ctx.user.consents ?? []), ...consentRecords(documents)] },
      });
      return { success: true };
    }),
});
