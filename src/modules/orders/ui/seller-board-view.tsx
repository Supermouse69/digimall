"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

import { PushToggle } from "@/modules/notifications/ui/push-toggle";

import { ModeBadge, OrderCard } from "./order-card";

const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

// Seller's Orders board: a tile grid like the Google Sheets beta (CLAUDE.md §13). Orders that need
// the store (new / payment to check) come first. Tap a tile for the full card with buttons.
export const SellerBoardView = ({ embedded }: { embedded: boolean }) => {
  const trpc = useTRPC();
  const [filter, setFilter] = useState<"active" | "done">("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const board = useQuery({ ...trpc.orders.board.queryOptions({ filter }), refetchInterval: whenVisible(15000) });

  const needsStore = (status: string) => status === "awaiting_store" || status === "payment_submitted";
  const tiles = [...(board.data ?? [])].sort((a, b) => Number(needsStore(b.status)) - Number(needsStore(a.status)));

  return (
    <div className={cn("flex flex-col gap-4 px-4 py-4", embedded ? "h-dvh overflow-y-auto bg-white" : "max-w-5xl mx-auto min-h-screen")}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-medium">Orders</h1>
        {embedded && (
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => window.parent.postMessage("digimall-orders-close", window.location.origin)}>
            <XIcon />
          </Button>
        )}
      </div>
      <PushToggle className="w-fit" />
      <div className="flex gap-2">
        {(["active", "done"] as const).map((value) => (
          <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>
            {value === "active" ? "Active" : "Finished / cancelled"}
          </Button>
        ))}
      </div>
      {board.isLoading && <p>Loading…</p>}
      {tiles.length === 0 && !board.isLoading && <p className="text-neutral-600">No orders here.</p>}
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <li key={tile.id}>
            <button
              type="button"
              onClick={() => setOpenId(tile.id)}
              className={cn(
                "w-full h-full text-left rounded-md border-2 bg-white p-3 flex flex-col gap-1",
                needsStore(tile.status) ? "border-black" : "border-neutral-200",
              )}
            >
              <ModeBadge mode={tile.order.mode} />
              <span className="font-semibold">{tile.code}</span>
              <span className="text-sm">{tile.statusLabel}</span>
              <span className="text-sm text-neutral-600">{tile.order.buyerName}</span>
              <span className="text-sm">{formatCurrency(tile.subtotal)} · {timeLabel(tile.createdAt)}</span>
              {tile.paymentNeedsCheck && <span className="text-xs font-semibold text-red-700">⚠️ Check payment</span>}
            </button>
          </li>
        ))}
      </ul>
      {openId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-2" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-end">
              <Button variant="secondary" size="icon" aria-label="Close" onClick={() => setOpenId(null)}>
                <XIcon />
              </Button>
            </div>
            <OrderCard storeOrderId={openId} />
          </div>
        </div>
      )}
    </div>
  );
};
