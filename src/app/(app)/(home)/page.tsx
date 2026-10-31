import { Suspense } from "react";
import type { SearchParams } from "nuqs/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { DEFAULT_LIMIT } from "@/constants";
import { getQueryClient, trpc } from "@/trpc/server";
import { ProductListView } from "@/modules/products/ui/views/product-list-view";
import { loadProductFilters } from "@/modules/products/search-params";
import { StoresByBarangay, StoresByBarangaySkeleton } from "@/modules/tenants/ui/components/stores-by-barangay";

interface Props {
  searchParams: Promise<SearchParams>;
}

const Page = async ({ searchParams }: Props) => {
  const filters = await loadProductFilters(searchParams);

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.tenants.byBarangay.queryOptions());
  void queryClient.prefetchInfiniteQuery(
    trpc.products.getMany.infiniteQueryOptions(
      { ...filters, limit: DEFAULT_LIMIT },
      { getNextPageParam: (lastPage) => lastPage.nextPage },
    ),
  );

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Hidden while searching, so results come first */}
      {!filters.search && (
        <Suspense fallback={<StoresByBarangaySkeleton />}>
          <StoresByBarangay />
        </Suspense>
      )}
      <ProductListView />
    </HydrationBoundary>
  );
};

export default Page;
