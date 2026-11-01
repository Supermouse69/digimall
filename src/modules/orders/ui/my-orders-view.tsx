"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { formatCurrency } from "@/lib/utils";

import { ORDER_LABELS } from "../state";
import { ModeBadge } from "./order-card";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// "My Orders" (replaces the tutorial's digital-products library, CLAUDE.md §5)
export const MyOrdersView = () => {
  const trpc = useTRPC();
  const orders = useQuery(trpc.orders.mine.queryOptions());

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4">
      <h1 className="text-3xl font-medium">My orders</h1>
      {orders.isLoading && <p>Loading…</p>}
      {orders.data?.length === 0 && (
        <p>
          No orders yet. <Link href="/" className="underline">Browse stores</Link>
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {orders.data?.map((order) => (
          <li key={order.code}>
            <Link href={`/orders/${order.code}`} className="block rounded-md border bg-white p-4 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-shadow">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-lg">{order.code}</span>
                <ModeBadge mode={order.mode} />
              </div>
              <p className="font-medium">{ORDER_LABELS[order.status]}</p>
              {order.refundPending && <p className="text-sm font-medium text-orange-700">💸 Refund in progress</p>}
              <p className="text-sm text-neutral-600">
                {dateLabel(order.createdAt)} · {order.storeCount} store{order.storeCount === 1 ? "" : "s"} · {formatCurrency(order.total)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
