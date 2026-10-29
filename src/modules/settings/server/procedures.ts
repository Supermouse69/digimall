import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { getLegalDocuments, REQUIRED_DOCUMENTS } from "@/modules/legal/server/consents";

import { getSettings } from "./settings";

export const settingsRouter = createTRPCRouter({
  // Only what the public sign-up form needs — never the whole settings document.
  signupOptions: baseProcedure.query(async ({ ctx }) => {
    const settings = await getSettings(ctx.db);
    const documents = await getLegalDocuments(ctx.db, REQUIRED_DOCUMENTS.buyer);

    return {
      barangays: settings.barangays,
      serviceCenter: settings.serviceCenter,
      serviceRadiusKm: settings.serviceRadiusKm,
      minimumAge: settings.minimumAge,
      keyPoints: settings.signupKeyPoints
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      documents,
    };
  }),
});
