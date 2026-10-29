import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";

import { baseProcedure, createTRPCRouter } from "@/trpc/init";

import { generateAuthCookie } from "../utils";
import { loginSchema, registerSchema } from "../schemas";

export const authRouter = createTRPCRouter({
  session: baseProcedure.query(async ({ ctx }) => {
    const headers = await getHeaders();

    const session = await ctx.db.auth({ headers });

    return session;
  }),
  register: baseProcedure
    .input(registerSchema)
    .mutation(async ({ input, ctx }) => {
      const existingData = await ctx.db.find({
        collection: "users",
        limit: 1,
        where: {
          username: {
            equals: input.username,
          },
        },
      });

      const existingUser = existingData.docs[0];

      if (existingUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Username already taken",
        });
      }

      // Stores are created only by the super-admin, so sign-up makes a plain user (no store)
      try {
        await ctx.db.create({
          collection: "users",
          data: {
            email: input.email,
            username: input.username,
            password: input.password, // This will be hashed
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
    }),
    login: baseProcedure
    .input(loginSchema)
    .mutation(async ({ input, ctx }) => {
      let token: string | undefined;
      try {
        const data = await ctx.db.login({
          collection: "users",
          data: {
            email: input.email,
            password: input.password,
          },
        });
        token = data.token;
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

      // The token lives only in the HttpOnly cookie; never send it to page JavaScript
      return { success: true };
    }),
});