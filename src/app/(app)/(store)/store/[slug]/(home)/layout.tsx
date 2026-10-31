import { Suspense } from "react";
import { notFound } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { Footer } from "@/modules/tenants/ui/components/footer";
import { Navbar, NavbarSkeleton } from "@/modules/tenants/ui/components/navbar";
import { requireCurrentConsent } from "@/modules/legal/server/require-consent";
import { caller, getQueryClient, trpc } from "@/trpc/server";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

const Layout = async ({ params, children }: LayoutProps) => {
  const { slug } = await params;
  await requireCurrentConsent();

  // Pending, suspended or unknown stores show a normal "not found" page
  const store = await caller.tenants.getOne({ slug }).catch(() => null);
  if (!store) notFound();

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.tenants.getOne.queryOptions({ slug }));

  return (
    <div className="min-h-screen bg-[#F4F4F0] flex flex-col">
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<NavbarSkeleton />}>
          <Navbar slug={slug} />
        </Suspense>
      </HydrationBoundary>
      <div className="flex-1">
        <div className="max-w-(--breakpoint-xl) mx-auto">{children}</div>
      </div>
      <Footer />
    </div>
  );
};

export default Layout;
