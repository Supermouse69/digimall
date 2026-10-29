import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";

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

import { generateAuthCookie } from "../utils";
import { homeForRole, type UserRole } from "../roles";
import { acceptConsentsSchema, loginSchema, registerSchema } from "../schemas";

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
    .input(registerSchema)
    .mutation(async ({ input, ctx }) => {
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
          },
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not create account. The email may already be in use.",
        });
      }

      const data = await ctx.db.login({
        collection: "users",
        data: {
          email: input.email,
          password: input.password,
        },
      });

      if (!data.token) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Failed to login",
        });
      }

      await generateAuthCookie({
        prefix: ctx.db.config.cookiePrefix,
        value: data.token,
      });

      return { redirectTo: homeForRole("buyer", input.next) };
    }),

  login: baseProcedure
    .input(loginSchema)
    .mutation(async ({ input, ctx }) => {
      let token: string | undefined;
      let role: UserRole | undefined;
      try {
        const data = await ctx.db.login({
          collection: "users",
          data: {
            email: input.email,
            password: input.password,
          },
        });
        token = data.token;
        role = (data.user as User | undefined)?.role;
      } catch {
        // Same message for every failure so attackers can't tell which emails exist
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
      return { redirectTo: homeForRole(role, input.next) };
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
