import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { getLegalDocuments, REQUIRED_DOCUMENTS } from "@/modules/legal/server/consents";

import { getSettings, toKeyPointList } from "./settings";

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
      keyPoints: toKeyPointList(settings.signupKeyPoints),
      documents,
    };
  }),

  // Cart + checkout box: the store limit and the developer's "Quick reminders" text
  cartOptions: baseProcedure.query(async ({ ctx }) => {
    const settings = await getSettings(ctx.db);
    return {
      maxStoresPerCart: settings.maxStoresPerCart,
      checkoutKeyPoints: toKeyPointList(settings.checkoutKeyPoints),
    };
  }),
});
