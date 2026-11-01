"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ClockIcon, MapPinIcon, StoreIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { ChatWithStoreButton } from "@/modules/chat/ui/chat-with-store-button";
import { ReportButton } from "@/modules/reports/ui/report-button";

import { StoreBadge } from "./store-badge";

// Leaflet needs the browser (window), so the map loads only on the client
const StoreMap = dynamic(() => import("@/components/map/store-map"), {
  ssr: false,
  loading: () => <div className="h-48 w-full rounded-md border bg-neutral-100 animate-pulse" />,
});

const sinceLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", year: "numeric" });

// Store page header with the merchant info buyers are allowed to see (CLAUDE.md §8, §11.2).
// Never shows permit numbers, TIN, IDs, or the owner's phone/email.
export const StoreHeader = ({ slug }: { slug: string }) => {
  const trpc = useTRPC();
  const { data: store } = useSuspenseQuery(trpc.tenants.getOne.queryOptions({ slug }));
  const address = [store.addressDetails, store.barangay, store.barangay ? "Calumpit, Bulacan" : null]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="px-4 lg:px-12 pt-6 flex flex-col gap-4">
      {store.banner?.url && (
        <div className="relative w-full aspect-[4/1] overflow-hidden rounded-md border bg-white">
          <Image src={store.banner.url} alt={`${store.name} banner`} fill sizes="100vw" className="object-cover" priority />
        </div>
      )}
      <div className="rounded-md border bg-white p-4 lg:p-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {store.logo?.url ? (
              <Image src={store.logo.url} alt={store.name} width={56} height={56} className="size-14 rounded-full border object-cover shrink-0" />
            ) : (
              <div className="size-14 rounded-full border flex items-center justify-center shrink-0 bg-neutral-50">
                <StoreIcon className="size-6" />
              </div>
            )}
            <div className="flex flex-col gap-1 min-w-0">
              <h1 className="text-2xl lg:text-3xl font-medium break-words">{store.name}</h1>
              <StoreBadge status={store.status} className="w-fit" />
            </div>
          </div>
          {store.description && <p className="whitespace-pre-line">{store.description}</p>}
          <dl className="grid gap-2 text-sm">
            {store.ownerName && (
              <div className="flex gap-2">
                <dt className="text-neutral-600 shrink-0">Owner / business:</dt>
                <dd className="font-medium">{store.ownerName}</dd>
              </div>
            )}
            {address && (
              <div className="flex gap-2 items-start">
                <dt className="sr-only">Address</dt>
                <MapPinIcon className="size-4 mt-0.5 shrink-0" />
                <dd>{address}</dd>
              </div>
            )}
            {store.openingTime && store.closingTime && (
              <div className="flex gap-2 items-start">
                <dt className="sr-only">Open</dt>
                <ClockIcon className="size-4 mt-0.5 shrink-0" />
                <dd>Open {store.openingTime} – {store.closingTime}</dd>
              </div>
            )}
            {store.hours && (
              <div className="flex gap-2 items-start">
                <dt className="sr-only">Opening hours</dt>
                <ClockIcon className="size-4 mt-0.5 shrink-0" />
                <dd>{store.hours}</dd>
              </div>
            )}
            <div className="text-neutral-600">On DigiMall since {sinceLabel(store.memberSince)}</div>
          </dl>
          <div className="flex flex-wrap items-center gap-4">
            <ChatWithStoreButton storeSlug={store.slug} className="w-fit" />
            <ReportButton targetType="store" targetId={store.id} />
          </div>
        </div>
        {store.location && (
          <div className="flex flex-col gap-1">
            <StoreMap point={store.location} />
            <p className="text-xs text-neutral-600">Approximate store location</p>
          </div>
        )}
      </div>
    </section>
  );
};

export const StoreHeaderSkeleton = () => (
  <section className="px-4 lg:px-12 pt-6">
    <div className="h-40 rounded-md border bg-white animate-pulse" />
  </section>
);
