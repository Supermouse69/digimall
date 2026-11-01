import z from "zod";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { guardRateLimit } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

// Phone notifications: the logged-in user turns them on/off for this browser
export const notificationsRouter = createTRPCRouter({
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1000).refine((url) => url.startsWith("https://"), "Invalid push address."),
        p256dh: z.string().min(10).max(200),
        auth: z.string().min(8).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.pushSubscribe, `user:${ctx.user.id}`);
      const { docs } = await ctx.db.find({ collection: "push-subscriptions", where: { endpoint: { equals: input.endpoint } }, depth: 0, limit: 1, overrideAccess: true });
      // Same browser, another account logged in: the subscription moves to the new account
      if (docs[0]) await ctx.db.delete({ collection: "push-subscriptions", id: docs[0].id, overrideAccess: true });
      await ctx.db.create({ collection: "push-subscriptions", data: { user: ctx.user.id, ...input }, overrideAccess: true });
      return { subscribed: true as const };
    }),

  unsubscribe: protectedProcedure.input(z.object({ endpoint: z.string().max(1000) })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete({
      collection: "push-subscriptions",
      where: { and: [{ endpoint: { equals: input.endpoint } }, { user: { equals: ctx.user.id } }] },
      overrideAccess: true,
    });
    return { unsubscribed: true as const };
  }),
});
