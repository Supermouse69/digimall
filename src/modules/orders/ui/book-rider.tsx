"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleIcon, PhoneIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { useChatWidget } from "@/modules/chat/ui/chat-widget-store";

import type { OrderStatus } from "../state";

const TripMap = dynamic(() => import("@/components/map/trip-map"), {
  ssr: false,
  loading: () => <div className="h-64 rounded-md border bg-neutral-100 animate-pulse" />,
});

const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);
const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const minutesAgo = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : null);

const Countdown = ({ until }: { until: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ms = Math.max(0, Date.parse(until) - now);
  return <span className="font-mono">{Math.floor(ms / 60000)}:{String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}</span>;
};

const Photo = ({ url, name }: { url: string | null; name: string }) =>
  url ? (
    // Private file served through our access check
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} className="size-12 rounded-full border object-cover shrink-0" />
  ) : (
    <div className="size-12 rounded-full border flex items-center justify-center shrink-0 bg-neutral-50">
      <UserIcon className="size-5" />
    </div>
  );

// Book a rider and follow the trip (CLAUDE.md §11.7). The buyer picks a rider (or auto-pick nearest).
export const BookRider = ({ code, status, deliveryPoint }: { code: string; status: OrderStatus; deliveryPoint: { lat: number; lng: number } | null }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const openChat = useChatWidget((state) => state.open);
  const trip = useQuery({ ...trpc.trips.buyerTrip.queryOptions({ code }), refetchInterval: whenVisible(5000) });
  const riders = useQuery({ ...trpc.trips.riders.queryOptions({ code }), enabled: status === "ready_to_book", refetchInterval: whenVisible(15000) });
  const refresh = () => Promise.all([queryClient.invalidateQueries(trpc.trips.pathFilter()), queryClient.invalidateQueries(trpc.orders.pathFilter())]);
  const request = useMutation(trpc.trips.request.mutationOptions({ onSuccess: refresh, onError: (error) => toast.error(error.message) }));
  const cancel = useMutation(trpc.trips.cancelRequest.mutationOptions({ onSuccess: refresh }));

  // The order page shows the newest status from this query (e.g. a rider just accepted)
  const current = trip.data?.status ?? status;
  useEffect(() => {
    if (trip.data && trip.data.status !== status) void queryClient.invalidateQueries(trpc.orders.pathFilter());
  }, [trip.data, status, queryClient, trpc.orders]);

  if (current === "ready_to_book") {
    return (
      <div className="rounded-md border-2 border-green-600 bg-green-50 p-4 flex flex-col gap-3">
        <p className="font-medium">🟢 Every store is paid. Book a rider now.</p>
        {(trip.data?.triedCount ?? 0) > 0 && <p className="text-sm">The last rider didn&apos;t accept. Pick another one.</p>}
        <Button className="bg-black text-white" disabled={request.isPending || riders.data?.length === 0} onClick={() => request.mutate({ code, auto: true })}>
          Auto-pick nearest rider
        </Button>
        {riders.isLoading && <p className="text-sm">Looking for riders…</p>}
        {riders.data?.length === 0 && <p className="text-sm">No riders are available right now. This list refreshes by itself.</p>}
        <ul className="flex flex-col gap-2">
          {riders.data?.map((rider) => (
            <li key={rider.riderId} className="rounded-md border bg-white p-3 flex items-center gap-3">
              <Photo url={rider.photoUrl} name={rider.firstName} />
              <div className="flex-1">
                <p className="font-medium">{rider.firstName}</p>
                <p className="text-sm text-neutral-600">{rider.distance} from the store (approx.)</p>
              </div>
              <Button size="sm" variant="outline" disabled={request.isPending} onClick={() => request.mutate({ code, riderId: rider.riderId })}>
                Request
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (current === "rider_requested" && trip.data?.pending) {
    return (
      <div className="rounded-md border-2 border-amber-500 bg-amber-50 p-4 flex flex-col gap-2">
        <p className="font-medium">Waiting for {trip.data.pending.firstName} to accept…</p>
        {trip.data.pending.expiresAt && <p className="text-sm">Time left: <Countdown until={trip.data.pending.expiresAt} /></p>}
        {trip.data.pending.auto && <p className="text-sm">If they don&apos;t accept, we&apos;ll ask the next nearest rider.</p>}
        <Button variant="outline" className="w-fit" disabled={cancel.isPending} onClick={() => cancel.mutate({ code })}>Cancel request</Button>
      </div>
    );
  }

  const rider = trip.data?.rider;
  if (!rider) return null;
  const active = current === "rider_assigned" || current === "on_the_way";
  const seen = minutesAgo(rider.location?.at ?? null);
  return (
    <div className="rounded-md border bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Photo url={rider.photoUrl} name={rider.firstName} />
        <div className="flex-1">
          <p className="font-medium">Rider {rider.firstName}</p>
          <p className="text-sm text-neutral-600">
            {current === "rider_assigned" ? "Going to the store" : current === "on_the_way" ? "On the way to you" : "Delivered"}
          </p>
        </div>
      </div>
      {active && (
        <>
          <div className="flex gap-2 flex-wrap">
            {rider.phone && <Button asChild variant="outline" size="sm"><a href={telLink(rider.phone)}><PhoneIcon /> Call rider</a></Button>}
            {rider.conversationId && (
              <Button variant="outline" size="sm" onClick={() => openChat({ conversationId: rider.conversationId! })}>
                <MessageCircleIcon /> Chat with rider
              </Button>
            )}
          </div>
          {(rider.location || deliveryPoint) && (
            <TripMap
              stores={[]}
              home={deliveryPoint ? { point: deliveryPoint, label: "You" } : null}
              rider={rider.location ? { point: rider.location, label: `Rider ${rider.firstName}` } : null}
            />
          )}
          {seen !== null && <p className="text-xs text-neutral-600">Rider location updated {seen === 0 ? "just now" : `${seen} min ago`}.</p>}
        </>
      )}
      {current === "delivered" && rider.feeCollected != null && <p className="text-sm">Delivery fee paid to the rider: {formatCurrency(rider.feeCollected)}</p>}
    </div>
  );
};
