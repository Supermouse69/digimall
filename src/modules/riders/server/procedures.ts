import z from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import type { PrivateMedia, RiderProfile } from "@/payload-types";

const RIDER_DOCUMENT_FIELDS = ["photo", "licenseDocument", "franchiseDocument"] as const;

// Riders only. The user always comes from the login cookie (ctx.user), never from the browser.
const riderProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "rider") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Riders only." });
  }
  return next();
});

const fileUrl = (file: string | PrivateMedia | null | undefined) =>
  file && typeof file === "object" && file.url ? file.url : null;

const findOwnProfile = async (ctx: { db: import("payload").Payload; user: { id: string } }) => {
  const { docs } = await ctx.db.find({
    collection: "rider-profiles",
    where: { user: { equals: ctx.user.id } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  });
  return docs[0] as RiderProfile | undefined;
};

export const ridersRouter = createTRPCRouter({
  myProfile: riderProcedure.query(async ({ ctx }) => {
    const profile = await findOwnProfile(ctx);
    if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Rider profile not found." });

    return {
      displayName: profile.displayName,
      status: profile.status,
      todaName: profile.todaName ?? "",
      // Private files: these URLs only work for the rider (and the super-admin), checked on the server
      photoUrl: fileUrl(profile.photo),
      licenseUrl: fileUrl(profile.licenseDocument),
      franchiseUrl: fileUrl(profile.franchiseDocument),
    };
  }),

  attachDocument: riderProcedure
    .input(
      z.object({
        field: z.enum(RIDER_DOCUMENT_FIELDS),
        fileId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await findOwnProfile(ctx);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Rider profile not found." });

      try {
        // Runs as the rider (overrideAccess: false): access rules + "you uploaded it yourself" check apply
        await ctx.db.update({
          collection: "rider-profiles",
          id: profile.id,
          data: { [input.field]: input.fileId },
          user: ctx.user,
          overrideAccess: false,
        });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Couldn't save that file. Please upload it again." });
      }
      return { success: true as const };
    }),
});
