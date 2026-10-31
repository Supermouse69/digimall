import z from "zod";
import { TRPCError } from "@trpc/server";
import type { Sort, Where } from "payload";

import { Category, Media, Tenant } from "@/payload-types";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";

import { sortValues } from "../search-params";
import { DEFAULT_LIMIT } from "@/constants";

export const productsRouter = createTRPCRouter({
  getOne: baseProcedure
  .input(
    z.object({
      id: z.string().max(100),
      // The store in the URL: a product opened under another store's address is "not found"
      tenantSlug: z.string().max(100).optional(),
    })
  )
  .query(async({ctx,input}) => {
    // overrideAccess: false = the public access rules apply (no hidden products, no hidden stores,
    // and the store's private fields are left out of the populated tenant)
    const product = await ctx.db
      .findByID({ collection: "products", id: input.id, depth: 2, overrideAccess: false })
      .catch(() => null);
    const tenant = product?.tenant as Tenant | string | null | undefined;
    if (!product || (input.tenantSlug && (typeof tenant !== "object" || tenant?.slug !== input.tenantSlug))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    }
    return {
      ...product,
      image:product.image as Media | null,
      cover:product.cover as Media | null,// added cover for diffrent picture for inside item shop vs slection item card/product card
      tenant:product.tenant as Tenant & {logo:Media | null},
    }
  }),
  getMany: baseProcedure
    .input(
      z.object({
        cursor: z.number().default(1),
        limit: z.number().default(DEFAULT_LIMIT),
        category: z.string().nullable().optional(),
        search: z.string().max(100).nullable().optional(),
        minPrice: z.string().max(12).nullable().optional(),
        maxPrice: z.string().max(12).nullable().optional(),
        sort: z.enum(sortValues).nullable().optional(),
        tenantSlug: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Where = {};
      const SORTS: Record<(typeof sortValues)[number], Sort> = {
        newest: "-createdAt",
        price_low: "price",
        price_high: "-price",
      };
      const sort: Sort = SORTS[input.sort ?? "newest"];

      // Search by product name (Payload "like" = every word must appear, any letter case)
      const search = input.search?.trim();
      if (search) {
        where.name = { like: search };
      }

      // Price boxes send text; keep only the digits (whole pesos)
      const toPesos = (value?: string | null) => {
        const digits = value?.replace(/[^0-9.]/g, "");
        const pesos = digits ? Math.floor(Number(digits)) : NaN;
        return Number.isFinite(pesos) ? pesos : undefined;
      };
      const minPrice = toPesos(input.minPrice);
      const maxPrice = toPesos(input.maxPrice);
      if (minPrice !== undefined || maxPrice !== undefined) {
        where.price = {
          ...(minPrice !== undefined ? { greater_than_equal: minPrice } : {}),
          ...(maxPrice !== undefined ? { less_than_equal: maxPrice } : {}),
        };
      }
      
      if (input.tenantSlug){
        where["tenant.slug"] ={
          equals: input.tenantSlug,
        };
      }

      if (input.category) {
        const categoriesData = await ctx.db.find({
          collection: "categories",
          limit: 1,
          depth: 2, // Populate subcategories, subcategores.[0] will be a type of "Category"
          pagination: false,
          where: {
            slug: {
              equals: input.category,
            }
          }
        });
        
        const formattedData = categoriesData.docs.map((doc) => ({
          ...doc,
          subcategories: (doc.subcategories?.docs ?? []).map((doc) => ({
            // Because of "depth: 1" we are confident "doc" will be a type of "Category"
            ...(doc as Category),
            subcategories: undefined,
          }))
        }));

        const subcategoriesSlugs = [];
        const parentCategory = formattedData[0];

        if (parentCategory) {
          subcategoriesSlugs.push(
            ...parentCategory.subcategories.map((subcategory) => subcategory.slug)
          )

          where["category.slug"] = {
            in: [parentCategory.slug, ...subcategoriesSlugs]
          }
        }
      }

      const data = await ctx.db.find({
        collection: "products",
        depth: 2, // Populate "category" & "image",
        where,
        sort,
        page:input.cursor,
        limit:input.limit,
        overrideAccess: false, // public rules: see getOne
      });
       return {
        ...data,
        docs: data.docs.map((doc) => ({
          ...doc,
          image: doc.image as Media | null,
          tenant: doc.tenant as Tenant & { logo: Media | null },
        }))
      }
    }),
});