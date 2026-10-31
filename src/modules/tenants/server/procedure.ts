import z from "zod";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import {TRPCError} from "@trpc/server";
import { Media, Tenant } from "@/payload-types";



export const tenantsRouter = createTRPCRouter({
  getOne: baseProcedure
    .input(
      z.object({
        slug:z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      

      // overrideAccess: false = only approved stores, and no private fields (phone, QR, documents)
      const tenantsData = await ctx.db.find({
        collection: "tenants",
        depth:1,
        overrideAccess: false,
        where:{
            slug:{
                equals:input.slug,
            },
        },
        limit: 1,
        pagination: false,
      });

      const tenant = tenantsData.docs[0];

      if(!tenant){
        throw new TRPCError({ code: "NOT_FOUND" , message: "Store not found"});
      }
      return tenant as Tenant & { logo: Media | null; banner: Media | null };
    }),
});
