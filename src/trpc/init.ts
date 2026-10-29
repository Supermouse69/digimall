import { initTRPC, TRPCError } from '@trpc/server';
import { headers as getHeaders } from "next/headers";
import { getPayload } from 'payload';
import { cache } from 'react';
import config from "@payload-config";
import type { User } from "@/payload-types";

 
// The session is read per procedure (ctx.db.auth) — nothing user-specific lives here yet
export const createTRPCContext = cache(async () => {
  return {};
});
 
// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  // transformer: superjson,
});
 
// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure.use(async({ next }) => {
  const payload = await getPayload ({config});

  return next({ctx: {db: payload}});
});

// Logged-in users only. The user comes from the auth cookie on the server — never from the browser.
export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  const headers = await getHeaders();
  const { user } = await ctx.db.auth({ headers });

  if (!user || user.collection !== "users") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in first." });
  }

  return next({ ctx: { ...ctx, user: user as User } });
});
