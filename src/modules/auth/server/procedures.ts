import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";

import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { getUserTenantIds } from "@/lib/access";
import type { User } from "@/payload-types";

import { generateAuthCookie } from "../utils";
import { homeForRole, type UserRole } from "../roles";
import { loginSchema, registerSchema } from "../schemas";

// What the browser is allowed to know about the logged-in user. Never send the whole user document.
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  store: { slug: string; name: string } | null;
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

    return {
      user: {
        id: fullUser.id,
        name: fullUser.name,
        email: fullUser.email,
        role: fullUser.role,
        store,
      },
    };
  }),

  register: baseProcedure
    .input(registerSchema)
    .mutation(async ({ input, ctx }) => {
      // Public sign-up is for buyers only. Sellers and riders are created by the super-admin.
      try {
        await ctx.db.create({
          collection: "users",
          data: {
            name: input.name,
            email: input.email,
            password: input.password, // This will be hashed
            role: "buyer",
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
});
