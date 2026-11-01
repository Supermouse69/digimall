"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { useChatWidget } from "@/modules/chat/ui/chat-widget-store";

import { ORDER_LABELS } from "../state";
import { PushToggle } from "@/modules/notifications/ui/push-toggle";

import { BookRider } from "./book-rider";
import { ModeBadge, OrderCard } from "./order-card";

const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);

// One order (DM-XXXX) with each store's part. Not an official receipt (CLAUDE.md §9 BIR).
export const OrderDetailView = ({ code }: { code: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const openChat = useChatWidget((state) => state.open);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const detail = useQuery({ ...trpc.orders.detail.queryOptions({ code }), refetchInterval: whenVisible(10000) });
  const cancelOrder = useMutation(trpc.orders.cancelOrder.mutationOptions({
    onSuccess: async (result) => {
      setConfirmCancel(false);
      toast.success(result.refundsStarted > 0 ? "Order cancelled. Send your GCash QR in each store's chat to get your refund." : "Order cancelled");
      await queryClient.invalidateQueries(trpc.orders.pathFilter());
    },
    onError: (error) => toast.error(error.message),
  }));

  if (detail.isLoading) return <p className="max-w-3xl mx-auto px-4 py-8">Loading…</p>;
  if (detail.isError || !detail.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p>Order not found.</p>
        <Link href="/orders" className="underline">My orders</Link>
      </div>
    );
  }
  const order = detail.data;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4">
      <Link href="/orders" className="underline text-sm w-fit">← My orders</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-medium">{order.code}</h1>
        <ModeBadge mode={order.mode} />
      </div>
      <p className="text-lg font-medium">{ORDER_LABELS[order.status]}</p>

      {order.unbooked && order.status === "ready_to_book" && order.unbooked.remind && (
        <div className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm">
          ⏰ Please book a rider soon. {order.unbooked.selfPickupHoursBeforeClosing} hours before the store closes, this order becomes self-pickup.
        </div>
      )}
      {order.status === "self_pickup" && (
        <div className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm flex flex-col gap-1">
          <p className="font-medium">🏪 Self-pickup: no rider was booked in time.</p>
          <p>Please pick up your items at the store{order.storeOrders.length > 1 ? "s" : ""}:</p>
          <ul className="list-disc pl-5">
            {order.storeOrders.filter((so) => so.status === "paid").map((so) => (
              <li key={so.id}>{so.store.name}{so.store.closingTime ? ` (closes ${so.store.closingTime})` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {order.unbooked && (
        <p className="text-xs text-neutral-600">
          If not booked or picked up by {new Date(order.unbooked.autoRefundAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, the order is cancelled and each store refunds you.
        </p>
      )}
      {["ready_to_book", "rider_requested", "rider_assigned", "on_the_way", "delivered"].includes(order.status) && (
        <BookRider code={order.code} status={order.status} deliveryPoint={order.delivery.location} />
      )}
      <PushToggle className="w-fit" />

      {order.storeOrders.map((storeOrder) => (
        <div key={storeOrder.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link href={`/store/${storeOrder.store.slug}`} className="font-medium underline">{storeOrder.store.name}</Link>
            <Button variant="ghost" size="sm" onClick={() => openChat({ storeSlug: storeOrder.store.slug })}>
              <MessageCircleIcon /> Chat
            </Button>
          </div>
          <OrderCard storeOrderId={storeOrder.id} compact />
        </div>
      ))}

      <section className="rounded-md border bg-white p-4 flex flex-col gap-1 text-sm">
        <h2 className="text-base font-medium">Order Summary</h2>
        <p className="flex justify-between"><span>Items (paid to the stores by GCash)</span><strong>{formatCurrency(order.itemsTotal)}</strong></p>
        <p className="flex justify-between">
          <span>Estimated delivery fee (cash to the rider)</span>
          <strong>{order.fareEstimate != null ? formatCurrency(order.fareEstimate) : "Rider will tell you"}</strong>
        </p>
        <p>Deliver to: {[order.delivery.addressDetails, order.delivery.barangay].filter(Boolean).join(", ")}</p>
        {order.riderNotes && <p>Note for the rider: {order.riderNotes}</p>}
        <p className="text-neutral-600 mt-1">Order Summary — not an official receipt/invoice.</p>
      </section>

      {order.canCancelOrder && (
        <Button variant="outline" className="w-fit" onClick={() => setConfirmCancel(true)}>
          Cancel the whole order
        </Button>
      )}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.code}?</DialogTitle>
            <DialogDescription>Every store in this order is cancelled. Stores you already paid will refund you by GCash: you&apos;ll send your GCash QR in each store&apos;s chat.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep order</Button>
            <Button className="bg-red-600 text-white" disabled={cancelOrder.isPending} onClick={() => cancelOrder.mutate({ code })}>
              Yes, cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
