"use client";
import Image from "next/image";
import { useTRPC } from "@/trpc/client";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatCurrency, generateTenantURL } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LinkIcon, MessageCircleIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { toast } from "sonner";

import { ReportButton } from "@/modules/reports/ui/report-button";
import { StoreBadge } from "@/modules/tenants/ui/components/store-badge";

const CartButton = dynamic(
  () => import("../components/cart-button").then(
    (mod) => mod.CartButton,
  ),
  {
    ssr:false,
    loading: () => <Button disabled className="flex-1 bg-pink-400"> Add to cart </Button>
  },
);



interface ProductViewProps {
  productId: string;
  tenantSlug: string;
}

export const ProductView = ({ productId, tenantSlug }: ProductViewProps) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(
    trpc.products.getOne.queryOptions({ id: productId, tenantSlug }),
  );
  const isAvailable = data.isAvailable !== false;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <div className="px-4 lg:px-12 py-10">
      <div className="border rounded-sm bg-white overflow-hidden">
        <div className="relative aspect-[3.9] border-b">
          <Image
            src={data.cover?.url || "/placeholder.svg"} //added cover for diffrent picture for inside item shop vs slection item card/product card
            alt={data.name}
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-6">
          <div className="col-span-4">
            <div className="p-6">
              <h1 className="text-4xl font-medium">{data.name}</h1>
              {!isAvailable && (
                <p className="mt-2 inline-block rounded bg-black text-white text-sm font-medium px-2 py-1">Not available right now</p>
              )}
            </div>
            <div className="border-y flex">
              <div className="px-6 py-4 flex items-center justify-center border-r">
                <div className="px-2 py-1 border bg-pink-400 w-fit">
                  <p className="text-base font-medium">
                    {formatCurrency(data.price)}
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 flex items-center justify-center">
                <Link
                  href={generateTenantURL(tenantSlug)}
                  className="flex items-center gap-2"
                >
                  {data.tenant.logo?.url && (
                    <Image
                      src={data.tenant.logo.url}
                      alt={data.tenant.name}
                      width={20}
                      height={20}
                      className="rounded-full border shrink-0 size-5"
                    />
                  )}
                  <p className="text-base underline font-medium">
                    {data.tenant.name}
                  </p>
                </Link>
                <StoreBadge status={data.tenant.status === "verified" ? "verified" : "unverified"} className="ml-2" />
              </div>
            </div>

            <div className="p-6">
              {data.description ? (
                <p> {data.description} </p>
              ) : (
                <p className="font-medium text-muted-foreground italic">
                  No description provided
                </p>
              )}
            </div>
          </div>
          <div className="col-span-2">
            <div className="border-t lg:border-t-0 lg:border-l h-full">
              <div className="flex flex-col gap-4 p-6 border-b">
                <div className="flex flex-row items-center gap-2">
                  {isAvailable ? (
                    <CartButton
                      productId={productId}
                      tenantSlug={tenantSlug}
                    />
                  ) : (
                    <Button disabled variant="elevated" className="flex-1 bg-neutral-200">
                      Not available
                    </Button>
                  )}

                  <Button
                    className="size-12"
                    variant="elevated"
                    onClick={copyLink}
                    aria-label="Copy link"
                    title="Copy link"
                  >
                    <LinkIcon />
                  </Button>
                </div>
                {/* Store chat arrives in Phase 4 */}
                <Button variant="elevated" disabled className="bg-white" title="Chat is coming soon">
                  <MessageCircleIcon /> Chat with store (coming soon)
                </Button>
              </div>
              <div className="p-6">
                <ReportButton targetType="product" targetId={productId} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
