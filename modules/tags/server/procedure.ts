//import configPromise from "@payload-config";
//import { getPayload } from "payload";
import z from "zod";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

import { DEFAULT_LIMIT } from "@/constants";

export const tagsRouter = createTRPCRouter({
  getMany: baseProcedure
    .input(
      z.object({
        cursor: z.number().default(1),
        limit: z.number().default(DEFAULT_LIMIT),
      }),
    )
    .query(async ({ ctx, input }) => {
      

      const data = await ctx.db.find({
        collection: "tags",
        page: input.cursor,
        limit: input.limit,
      });

      //Artificial delay for dev/testing
      //await new Promise((resolve) => setTimeout(resolve,5000));
      return data;
    }),
});
