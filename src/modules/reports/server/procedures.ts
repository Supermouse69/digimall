import z from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { REPORT_REASONS, REPORT_TARGETS } from "../reasons";
import { guardRateLimit } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

const reasonValues = REPORT_REASONS.map((reason) => reason.value) as [string, ...string[]];

export const reportsRouter = createTRPCRouter({
  // Logged-in users only (developer decision 2026-10-31). The reporter always comes from the
  // login cookie; the target must be something the reporter can actually see.
  create: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(REPORT_TARGETS),
        targetId: z.string().min(1).max(100),
        reason: z.enum(reasonValues),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.report, `user:${ctx.user.id}`);

      const collection = input.targetType === "product" ? "products" : "tenants";
      const target = await ctx.db
        .findByID({ collection, id: input.targetId, depth: 0, overrideAccess: false })
        .catch(() => null);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that anymore." });

      const storeId =
        input.targetType === "store"
          ? target.id
          : (() => {
              const tenant = (target as { tenant?: unknown }).tenant;
              return typeof tenant === "string" ? tenant : (tenant as { id?: string } | null)?.id;
            })();

      // Same person reporting the same thing again while it's still open: keep the first one
      const { totalDocs } = await ctx.db.count({
        collection: "reports",
        where: {
          and: [
            { reporter: { equals: ctx.user.id } },
            { status: { equals: "open" } },
            input.targetType === "product" ? { product: { equals: target.id } } : { store: { equals: target.id }, targetType: { equals: "store" } },
          ],
        },
        overrideAccess: true,
      });
      if (totalDocs === 0) {
        await ctx.db.create({
          collection: "reports",
          overrideAccess: true, // nobody can create reports through the raw API; only here
          data: {
            targetType: input.targetType,
            product: input.targetType === "product" ? target.id : undefined,
            store: storeId,
            reason: input.reason as (typeof REPORT_REASONS)[number]["value"],
            note: input.note || undefined,
            reporter: ctx.user.id,
            status: "open",
          },
        });
      }
      return { success: true as const };
    }),
});
