import { notFound } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { ProductView } from "@/modules/products/ui/views/product-view";
import { caller, getQueryClient, trpc } from "@/trpc/server";

interface Props {
  params: Promise<{ productId: string; slug: string }>;
}

const Page = async ({ params }: Props) => {
  const { productId, slug } = await params;

  // Hidden products, products of hidden stores, and products opened under another store's
  // address all show a normal "not found" page
  const product = await caller.products.getOne({ id: productId, tenantSlug: slug }).catch(() => null);
  if (!product) notFound();

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.tenants.getOne.queryOptions({ slug }));
  void queryClient.prefetchQuery(trpc.products.getOne.queryOptions({ id: productId, tenantSlug: slug }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductView productId={productId} tenantSlug={slug} />
    </HydrationBoundary>
  );
};

export default Page;
