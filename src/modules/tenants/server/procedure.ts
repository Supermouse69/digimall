import z from "zod";
import { TRPCError } from "@trpc/server";

import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { fromPoint, type LatLng } from "@/lib/geo";
import type { Media, Tenant } from "@/payload-types";
import { getSettings } from "@/modules/settings/server/settings";

// Only what buyers may see about a store (CLAUDE.md §8 merchant info). Built field by field, so a
// new private field added to the collection later can never leak here by accident.
export type PublicStore = {
  id: string;
  name: string;
  slug: string;
  status: "unverified" | "verified";
  ownerName: string | null;
  description: string | null;
  barangay: string | null;
  addressDetails: string | null;
  location: LatLng | null;
  hours: string | null;
  logo: Media | null;
  banner: Media | null;
  memberSince: string;
};

const asMedia = (value: unknown): Media | null =>
  value && typeof value === "object" && "url" in value ? (value as Media) : null;

const toPublicStore = (tenant: Tenant): PublicStore => ({
  id: tenant.id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status === "verified" ? "verified" : "unverified",
  ownerName: tenant.ownerName ?? null,
  description: tenant.description ?? null,
  barangay: tenant.barangay ?? null,
  addressDetails: tenant.addressDetails ?? null,
  location: fromPoint(tenant.location as [number, number] | null | undefined),
  hours: tenant.hours ?? null,
  logo: asMedia(tenant.logo),
  banner: asMedia(tenant.banner),
  memberSince: tenant.createdAt,
});

export const tenantsRouter = createTRPCRouter({
  getOne: baseProcedure
    .input(z.object({ slug: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      // overrideAccess: false = only approved stores (pending/suspended ones "don't exist")
      const { docs } = await ctx.db.find({
        collection: "tenants",
        depth: 1,
        overrideAccess: false,
        where: { slug: { equals: input.slug } },
        limit: 1,
        pagination: false,
      });
      const tenant = docs[0];
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      return toPublicStore(tenant);
    }),

  // Home page: approved stores grouped by barangay, in the order of the Settings list
  byBarangay: baseProcedure.query(async ({ ctx }) => {
    const [{ docs }, settings] = await Promise.all([
      ctx.db.find({ collection: "tenants", depth: 1, overrideAccess: false, pagination: false, sort: "name" }),
      getSettings(ctx.db),
    ]);
    const stores = docs.map(toPublicStore);
    const groups = settings.barangays.map((barangay) => ({
      barangay,
      stores: stores.filter((store) => store.barangay === barangay),
    }));
    const others = stores.filter((store) => !store.barangay || !settings.barangays.includes(store.barangay));
    return [...groups, { barangay: "Other stores", stores: others }].filter((group) => group.stores.length > 0);
  }),
});
