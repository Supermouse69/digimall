import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Navbar } from "@/modules/home/ui/components/navbar";
import { Footer } from "@/modules/home/ui/components/footer";
import { SearchFilters, SearchFiltersSkeleton } from "@/modules/home/ui/components/search-filters";
import { getQueryClient, trpc } from "@/trpc/server";
import { Suspense } from "react";
import { requireCurrentConsent } from "@/modules/legal/server/require-consent";

interface Props {
  children: React.ReactNode;
}

const Layout = async ({ children }: Props) => {
  await requireCurrentConsent();

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.categories.getMany.queryOptions());

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<SearchFiltersSkeleton/>}>
          <SearchFilters />
        </Suspense>
      </HydrationBoundary>
      <div className="flex-1 bg-[#F4F4F0]">{children}</div>

      <Footer />
    </div>
  );
};

export default Layout;
