import z from "zod";
import { TRPCError } from "@trpc/server";

import { LEGAL_PAGE_SLUGS } from "@/collections/LegalPages";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

export const legalRouter = createTRPCRouter({
  getOne: baseProcedure
    .input(z.object({ slug: z.enum(LEGAL_PAGE_SLUGS) }))
    .query(async ({ ctx, input }) => {
      const { docs } = await ctx.db.find({
        collection: "legal-pages",
        where: { slug: { equals: input.slug } },
        depth: 0,
        limit: 1,
        select: { slug: true, title: true, content: true, version: true, publishedAt: true, updatedAt: true },
      });
      const page = docs[0];
      if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      return page;
    }),
});
