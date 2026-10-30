import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { RiderOnboardingView } from "@/modules/riders/ui/rider-onboarding-view";
import { caller, getQueryClient, trpc } from "@/trpc/server";

export const dynamic = "force-dynamic";

// Rider portal (mobile-first). Phase 2d: profile + documents. Phase 6 adds Active, requests, trips.
// Riders only, checked on the server.
const Page = async () => {
  const session = await caller.auth.session();
  if (!session.user) redirect("/login?next=/rider");
  if (session.user.role !== "rider") redirect("/");
  if (session.user.needsConsent) redirect("/consent?next=/rider");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(trpc.riders.myProfile.queryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RiderOnboardingView />
    </HydrationBoundary>
  );
};

export default Page;
