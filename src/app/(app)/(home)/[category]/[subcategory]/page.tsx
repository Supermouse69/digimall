import { DEFAULT_LIMIT } from "@/constants";
import { ProductListView } from "@/modules/products/ui/views/product-list-view";
import { loadProductFilters } from "@/modules/products/search-params";
import { ProductList,ProductListSkeleton } from "@/modules/products/ui/components/product-list";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { SearchParams } from "nuqs/server";
import { Suspense } from "react";

interface Props {
  params: Promise<{
    subcategory: string;
  }>;
  searchParams: Promise<SearchParams>;
}

const Page = async ({ params, searchParams }: Props) => {
  const { subcategory } = await params;
  const filters = await loadProductFilters(searchParams);

  const queryClient = getQueryClient();
  void queryClient.prefetchInfiniteQuery(trpc.products.getMany.infiniteQueryOptions({
            ...filters,
            category: subcategory,
            limit: DEFAULT_LIMIT,
          },
          {
            getNextPageParam: (lastPage) => lastPage.nextPage,
          }
        )
      );




  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductListView category={subcategory} />
    </HydrationBoundary>
  );
};

export default Page;
