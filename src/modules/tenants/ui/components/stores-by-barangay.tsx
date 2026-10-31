"use client";

import Link from "next/link";
import Image from "next/image";
import { useSuspenseQuery } from "@tanstack/react-query";
import { StoreIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { generateTenantURL } from "@/lib/utils";

import { StoreBadge } from "./store-badge";

// Home page: approved stores, grouped by barangay (CLAUDE.md §11.2). Scrolls sideways on phones.
export const StoresByBarangay = () => {
  const trpc = useTRPC();
  const { data: groups } = useSuspenseQuery(trpc.tenants.byBarangay.queryOptions());
  if (groups.length === 0) return null;

  return (
    <section className="px-4 lg:px-12 pt-8 flex flex-col gap-4">
      <h2 className="text-2xl font-medium">Stores</h2>
      {groups.map((group) => (
        <div key={group.barangay} className="flex flex-col gap-2">
          <h3 className="font-medium text-neutral-700">{group.barangay}</h3>
          <ul className="flex gap-3 overflow-x-auto pb-2 snap-x">
            {group.stores.map((store) => (
              <li key={store.id} className="snap-start shrink-0">
                <Link
                  href={generateTenantURL(store.slug)}
                  className="flex items-center gap-3 rounded-md border bg-white p-3 w-64 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-shadow"
                >
                  {store.logo?.url ? (
                    <Image src={store.logo.url} alt={store.name} width={40} height={40} className="size-10 rounded-full border object-cover shrink-0" />
                  ) : (
                    <div className="size-10 rounded-full border flex items-center justify-center shrink-0 bg-neutral-50">
                      <StoreIcon className="size-5" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-medium truncate">{store.name}</span>
                    <StoreBadge status={store.status} className="w-fit" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

export const StoresByBarangaySkeleton = () => (
  <section className="px-4 lg:px-12 pt-8">
    <div className="h-24 rounded-md border bg-white animate-pulse" />
  </section>
);
