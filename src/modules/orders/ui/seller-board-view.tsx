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

  const refundNeeded = (tile: { refundActions: string[] }) => tile.refundActions.includes("store_refund_sent");
  const needsStore = (tile: { status: string; refundActions: string[]; order: { status: string } }) =>
    tile.status === "awaiting_store" || tile.status === "payment_submitted" || refundNeeded(tile) || (tile.order.status === "self_pickup" && tile.status === "paid");
  // 🟠 REFUND NEEDED pinned on top (CLAUDE.md §11.9), then orders waiting for the store
  const rank = (tile: Parameters<typeof needsStore>[0]) => (refundNeeded(tile) ? 2 : needsStore(tile) ? 1 : 0);
  const tiles = [...(board.data ?? [])].sort((a, b) => rank(b) - rank(a));

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
                refundNeeded(tile) ? "border-orange-500 bg-orange-50" : needsStore(tile) ? "border-black" : "border-neutral-200",
              )}
            >
              {refundNeeded(tile) ? (
                <span className="rounded bg-orange-600 text-white text-xs font-semibold px-2 py-0.5 w-fit">🟠 REFUND NEEDED</span>
              ) : (
                <ModeBadge mode={tile.order.mode} />
              )}
              <span className="font-semibold">{tile.code}</span>
              <span className="text-sm">{tile.refund ? tile.refund.label : tile.order.status === "self_pickup" && tile.status === "paid" ? "🏪 Self-pickup" : tile.statusLabel}</span>
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
