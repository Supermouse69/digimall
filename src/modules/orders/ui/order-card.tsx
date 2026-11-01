"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";

import type { RefundAction, StoreOrderAction } from "../state";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);

// Receipts, refund QRs and refund proofs go to PRIVATE storage; only this buyer, this store
// (and the super-admin) see them
const uploadPrivate = async (file: File, purpose: "payment-receipt" | "refund-qr" | "refund-proof"): Promise<string> => {
  const body = new FormData();
  body.append("file", file);
  body.append("_payload", JSON.stringify({ purpose }));
  const res = await fetch("/api/private-media", { method: "POST", body, credentials: "include" });
  const json = (await res.json().catch(() => null)) as { doc?: { id: string }; errors?: { message?: string }[] } | null;
  if (!res.ok || !json?.doc?.id) throw new Error(json?.errors?.[0]?.message ?? "Upload failed. Please try again.");
  return json.doc.id;
};

// "9:41 left" countdown for the store-confirm and payment timers
const Countdown = ({ until }: { until: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ms = Math.max(0, Date.parse(until) - now);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return <span className="font-mono">{ms === 0 ? "time's up" : `${minutes}:${String(seconds).padStart(2, "0")} left`}</span>;
};

export const ModeBadge = ({ mode }: { mode: "casual" | "fast" }) =>
  mode === "fast" ? (
    <span className="rounded bg-red-600 text-white text-xs font-semibold px-2 py-0.5">🔴 URGENT · FAST</span>
  ) : (
    <span className="rounded bg-green-700 text-white text-xs font-semibold px-2 py-0.5">🟢 CASUAL</span>
  );

const STATUS_TONE: Record<string, string> = {
  awaiting_store: "bg-amber-50 border-amber-500",
  awaiting_payment: "bg-amber-50 border-amber-500",
  payment_submitted: "bg-blue-50 border-blue-500",
  paid: "bg-green-50 border-green-600",
  cancelled: "bg-neutral-100 border-neutral-400",
  expired: "bg-neutral-100 border-neutral-400",
};

// One store order with the right buttons for whoever is looking (buyer or store).
// Used in chat (order cards), on the buyer's order page and on the seller's Orders board.
export const OrderCard = ({ storeOrderId, compact }: { storeOrderId: string; compact?: boolean }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery({ ...trpc.orders.storeOrder.queryOptions({ storeOrderId }), refetchInterval: whenVisible(8000) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refundFileRef = useRef<HTMLInputElement>(null);

  const act = useMutation(trpc.orders.act.mutationOptions({
    onSuccess: async () => {
      setCancelOpen(false);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries(trpc.orders.pathFilter()),
        queryClient.invalidateQueries(trpc.chat.thread.queryFilter()),
      ]);
    },
    onError: (error) => toast.error(error.data?.code === "INTERNAL_SERVER_ERROR" ? "Something went wrong. Please try again." : error.message),
  }));

  const refundMutation = useMutation(trpc.orders.refund.mutationOptions({
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries(trpc.orders.pathFilter()), queryClient.invalidateQueries(trpc.chat.thread.queryFilter())]);
    },
    onError: (error) => toast.error(error.data?.code === "INTERNAL_SERVER_ERROR" ? "Something went wrong. Please try again." : error.message),
  }));

  if (query.isLoading) return <div className="h-24 rounded-md border bg-white animate-pulse" />;
  if (query.isError || !query.data) return <p className="text-sm text-neutral-600">This order isn&apos;t available.</p>;
  const order = query.data;
  const can = (action: StoreOrderAction) => order.actions.includes(action);
  const run = (action: StoreOrderAction, extra: { reason?: string; receiptId?: string; referenceNo?: string } = {}) =>
    act.mutate({ storeOrderId, action, ...extra });
  const isStoreView = order.viewer === "store";

  const onReceipt = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Please use a JPG, PNG, or WebP screenshot.");
    if (file.size > MAX_PHOTO_BYTES) return toast.error("That picture is over 5 MB.");
    setBusy(true);
    try {
      run("submit_payment", { receiptId: await uploadPrivate(file, "payment-receipt"), referenceNo: reference.trim() || undefined });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canRefund = (action: RefundAction) => order.refundActions.includes(action);
  // Buyer: their own GCash QR. Store: a screenshot of the refund it sent.
  const onRefundFile = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Please use a JPG, PNG, or WebP picture.");
    if (file.size > MAX_PHOTO_BYTES) return toast.error("That picture is over 5 MB.");
    const action: RefundAction = canRefund("buyer_send_qr") ? "buyer_send_qr" : "store_refund_sent";
    setBusy(true);
    try {
      const fileId = await uploadPrivate(file, action === "buyer_send_qr" ? "refund-qr" : "refund-proof");
      refundMutation.mutate({ storeOrderId, action, fileId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (refundFileRef.current) refundFileRef.current.value = "";
    }
  };

  return (
    <div className={cn("rounded-md border-2 bg-white p-3 flex flex-col gap-2 text-sm", order.refund && ["awaiting_store_refund", "escalated"].includes(order.refund.status) ? "bg-orange-50 border-orange-500" : STATUS_TONE[order.status])}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <span className="font-semibold text-base">{order.code}</span>
        <ModeBadge mode={order.order.mode} />
      </div>
      <p className="font-medium">{order.statusLabel}</p>
      {order.expiresAt && (
        <p className="text-neutral-700">
          ⏰ {order.status === "awaiting_store" ? "Store must confirm" : "Pay within"}: <Countdown until={order.expiresAt} />
        </p>
      )}
      {!compact && (
        <p className="text-neutral-700">
          {isStoreView ? `Buyer: ${order.order.buyerName}${order.order.barangay ? ` · ${order.order.barangay}` : ""}` : `Store: ${order.store.name}`}
        </p>
      )}
      <ul className="border-t pt-2">
        {order.items.map((item, index) => (
          <li key={index} className="flex justify-between">
            <span>{item.qty} × {item.name}</span>
            <span>{formatCurrency(item.price * item.qty)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t pt-2 font-semibold">
        <span>Total for this store</span>
        <span>{formatCurrency(order.subtotal)}</span>
      </p>
      {order.storeNotes && <p className="text-neutral-700">Note: {order.storeNotes}</p>}
      {order.cancel && (
        <p className="text-neutral-700">
          Cancelled by {order.cancel.by}{order.cancel.reason ? `: ${order.cancel.reason}` : ""}
        </p>
      )}
      {order.order.status === "self_pickup" && order.status === "paid" && (
        <p className="font-medium text-amber-800">
          🏪 Self-pickup: {isStoreView ? "the buyer will pick this up at your store." : `pick up your items at ${order.store.name}${order.store.closingTime ? ` before ${order.store.closingTime}` : ""}.`}
        </p>
      )}

      {/* Refund (CLAUDE.md §11.9) */}
      {order.refund && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <p className="font-semibold">{order.refund.label} · {formatCurrency(order.refund.amount)}</p>
          {order.refund.buyerQrUrl && (
            <a href={order.refund.buyerQrUrl} target="_blank" rel="noopener" className="underline w-fit">
              {isStoreView ? "Open the buyer's GCash QR" : "Your GCash QR"}
            </a>
          )}
          {order.refund.proofUrl && (
            <a href={order.refund.proofUrl} target="_blank" rel="noopener" className="underline w-fit">View the refund proof</a>
          )}
          <input ref={refundFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onRefundFile(event.target.files?.[0])} />
          {canRefund("buyer_send_qr") && (
            <Button className="bg-black text-white" disabled={busy || refundMutation.isPending} onClick={() => refundFileRef.current?.click()}>
              Send my GCash QR
            </Button>
          )}
          {canRefund("store_refund_sent") && (
            <>
              <p>Send {formatCurrency(order.refund.amount)} to the buyer&apos;s GCash, then upload a screenshot:</p>
              <Button className="bg-orange-600 text-white" disabled={busy || refundMutation.isPending} onClick={() => refundFileRef.current?.click()}>
                Refund sent (upload proof)
              </Button>
            </>
          )}
          {canRefund("buyer_refund_received") && (
            <Button className="bg-green-700 text-white" disabled={refundMutation.isPending} onClick={() => refundMutation.mutate({ storeOrderId, action: "buyer_refund_received" })}>
              Refund received
            </Button>
          )}
        </div>
      )}

      {order.paymentNotReceived && order.status === "payment_submitted" && (
        <p className="text-red-700 font-medium">⚠️ The store says this payment hasn&apos;t arrived. Please talk in the chat.</p>
      )}
      {order.paymentNeedsCheck && can("payment_received") && (
        <p className="text-red-700 font-medium">⚠️ Please check your GCash for this payment now.</p>
      )}

      {/* Buyer: pay this store by GCash, then send the receipt */}
      {order.gcashQrUrl && order.status === "awaiting_payment" && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <p className="font-medium">Pay {formatCurrency(order.subtotal)} to {order.store.name} by GCash:</p>
          {/* Private file served through our access check (only while you're paying) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={order.gcashQrUrl} alt={`${order.store.name} GCash QR`} className="w-56 h-56 object-contain border rounded bg-white self-center" />
          <label className="flex flex-col gap-1">
            <span>GCash reference no. (optional)</span>
            <input className="border rounded-md h-10 px-3" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={40} inputMode="numeric" />
          </label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onReceipt(event.target.files?.[0])} />
          <Button className="bg-black text-white" disabled={busy || act.isPending} onClick={() => fileRef.current?.click()}>
            {busy || act.isPending ? "Sending..." : "Upload receipt screenshot"}
          </Button>
        </div>
      )}
      {order.receiptUrl && (
        <a href={order.receiptUrl} target="_blank" rel="noopener" className="underline w-fit">
          View payment receipt{order.referenceNo ? ` (Ref. ${order.referenceNo})` : ""}
        </a>
      )}

      {/* Store buttons */}
      <div className="flex flex-wrap gap-2">
        {can("store_confirm") && (
          <Button className="bg-black text-white" disabled={act.isPending} onClick={() => run("store_confirm")}>
            Confirm order
          </Button>
        )}
        {can("payment_received") && (
          <Button className="bg-green-700 text-white" disabled={act.isPending} onClick={() => run("payment_received")}>
            Payment received
          </Button>
        )}
        {can("payment_not_received") && (
          <Button variant="outline" disabled={act.isPending} onClick={() => run("payment_not_received")}>
            Not received
          </Button>
        )}
        {can("buyer_picked_up") && (
          <Button className="bg-black text-white" disabled={act.isPending} onClick={() => run("buyer_picked_up")}>
            Buyer picked up
          </Button>
        )}
        {(can("store_cancel") || can("buyer_cancel")) && (
          <Button variant="outline" disabled={act.isPending} onClick={() => setCancelOpen(true)}>
            Cancel {isStoreView ? "order" : "this store"}
          </Button>
        )}
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.code}?</DialogTitle>
            <DialogDescription>
              {can("store_cancel") ? "Tell the buyer why (e.g., out of stock: Bear Brand)." : "The store will be told. You can still order again later."}
              {order.cancelNeedsRefund && (isStoreView ? " The buyer already paid: you'll need to refund them by GCash." : " You already paid, so the store will refund you by GCash (you'll send your GCash QR in the chat).")}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} placeholder={can("store_cancel") ? "Reason (required)" : "Reason (optional)"} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep order</Button>
            <Button
              className="bg-red-600 text-white"
              disabled={act.isPending || (can("store_cancel") && reason.trim().length < 3)}
              onClick={() => run(can("store_cancel") ? "store_cancel" : "buyer_cancel", { reason: reason.trim() || undefined })}
            >
              Yes, cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
