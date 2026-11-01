"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { PH_MOBILE_HINT } from "@/lib/ph-phone";
import { ChatPanel } from "@/modules/chat/ui/chat-panel";
import { PushToggle } from "@/modules/notifications/ui/push-toggle";
import { ModeBadge } from "@/modules/orders/ui/order-card";

// Leaflet needs the browser (window), so the map loads only on the client
const TripMap = dynamic(() => import("@/components/map/trip-map"), {
  ssr: false,
  loading: () => <div className="h-64 rounded-md border bg-neutral-100 animate-pulse" />,
});

const LOCATION_EVERY_MS = 25_000; // CLAUDE.md §11.13: every ~20–30 s while Active
const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);
const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

const Countdown = ({ until }: { until: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ms = Math.max(0, Date.parse(until) - now);
  return <span className="font-mono">{Math.floor(ms / 60000)}:{String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}</span>;
};

const getPosition = () =>
  new Promise<{ lat: number; lng: number }>((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This phone has no location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Allow location for DigiMall so buyers can find you.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  });

// While Active (and this page is open): send the latest position every ~25 s. Only the newest
// point is stored on the server; nothing is sent once Active is off.
const useLocationSender = (active: boolean) => {
  const trpc = useTRPC();
  const send = useMutation(trpc.trips.updateLocation.mutationOptions());
  const latest = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    const timer = setInterval(() => {
      if (latest.current && document.visibilityState === "visible") send.mutate(latest.current);
    }, LOCATION_EVERY_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when Active changes
  }, [active]);
};

const PhoneForm = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const save = useMutation(trpc.trips.setPhone.mutationOptions({
    onSuccess: () => {
      toast.success("Mobile number saved");
      void queryClient.invalidateQueries(trpc.trips.status.queryFilter());
    },
    onError: (error) => toast.error(error.message),
  }));
  return (
    <form className="rounded-md border bg-white p-4 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); save.mutate({ phone }); }}>
      <p className="font-medium">Add your mobile number</p>
      <p className="text-sm text-neutral-600">During a trip, the buyer and the store can call you (and you can call them). It&apos;s hidden after the trip.</p>
      <input className="border rounded-md h-11 px-3" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="09XXXXXXXXX" inputMode="tel" maxLength={16} />
      <p className="text-xs text-neutral-500">{PH_MOBILE_HINT}</p>
      <Button type="submit" disabled={save.isPending} className="bg-black text-white">Save</Button>
    </form>
  );
};

const IncomingRequest = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const incoming = useQuery({ ...trpc.trips.incoming.queryOptions(), refetchInterval: whenVisible(4000) });
  const respond = useMutation(trpc.trips.respond.mutationOptions({
    onSuccess: async (result) => {
      toast.success(result.accepted ? "Accepted! Head to the store." : "Declined");
      await queryClient.invalidateQueries(trpc.trips.pathFilter());
    },
    onError: (error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries(trpc.trips.pathFilter());
    },
  }));
  const request = incoming.data;
  if (!request) return <p className="text-sm text-neutral-600">Waiting for ride requests… keep this page open (or turn on notifications).</p>;
  return (
    <div className={cn("rounded-md border-4 bg-white p-4 flex flex-col gap-2", request.mode === "fast" ? "border-red-600" : "border-green-700")}>
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">New request · {request.code}</span>
        <ModeBadge mode={request.mode} />
      </div>
      {request.expiresAt && <p>Answer within <Countdown until={request.expiresAt} /></p>}
      <p>Pick up: {request.stores.map((store) => `${store.name}${store.barangay ? ` (${store.barangay})` : ""}`).join(", ")}</p>
      <p>Deliver to: {request.buyerBarangay ?? "—"}</p>
      <p>Delivery fee: <strong>{request.fareEstimate != null ? formatCurrency(request.fareEstimate) : "agree with the buyer"}</strong> (cash on delivery)</p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button variant="outline" size="lg" disabled={respond.isPending} onClick={() => respond.mutate({ orderId: request.orderId, accept: false })}>Decline</Button>
        <Button size="lg" className="bg-black text-white" disabled={respond.isPending} onClick={() => respond.mutate({ orderId: request.orderId, accept: true })}>Accept</Button>
      </div>
    </div>
  );
};

const ActiveTrip = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const trip = useQuery({ ...trpc.trips.myTrip.queryOptions(), refetchInterval: whenVisible(8000) });
  const [fee, setFee] = useState<string>("");
  const [showChat, setShowChat] = useState(false);
  const refresh = () => queryClient.invalidateQueries(trpc.trips.pathFilter());
  const pickUp = useMutation(trpc.trips.pickUp.mutationOptions({ onSuccess: refresh, onError: (error) => toast.error(error.message) }));
  const deliver = useMutation(trpc.trips.deliver.mutationOptions({
    onSuccess: () => {
      toast.success("Delivered! Great job.");
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  }));
  const data = trip.data;
  if (!data) return null;
  const feeValue = fee === "" ? (data.fareEstimate ?? 0) : Number(fee);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">Trip {data.code}</h2>
        <ModeBadge mode={data.mode} />
      </div>
      <TripMap
        stores={data.stops.filter((stop) => stop.location).map((stop) => ({ point: stop.location!, label: stop.storeName }))}
        home={data.buyer.location ? { point: data.buyer.location, label: "Deliver here" } : null}
      />
      <ol className="flex flex-col gap-2">
        {data.stops.map((stop, index) => (
          <li key={stop.storeOrderId} className="rounded-md border bg-white p-3 flex flex-col gap-1">
            <p className="font-medium">{index + 1}. {stop.storeName} · {stop.code}</p>
            <p className="text-sm">{[stop.addressDetails, stop.barangay].filter(Boolean).join(", ")}</p>
            <p className="text-sm">{stop.itemCount} item(s) · {stop.status === "picked_up" ? "✅ Picked up" : "Waiting for pickup"}</p>
            <div className="flex gap-2 flex-wrap">
              {stop.phone && <Button asChild variant="outline" size="sm"><a href={telLink(stop.phone)}><PhoneIcon /> Call store</a></Button>}
              {stop.canPickUp && (
                <Button size="sm" className="bg-black text-white" disabled={pickUp.isPending} onClick={() => pickUp.mutate({ storeOrderId: stop.storeOrderId })}>
                  Picked up
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-md border bg-white p-3 flex flex-col gap-1">
        <p className="font-medium">Deliver to {data.buyer.name}</p>
        <p className="text-sm">{[data.buyer.addressDetails, data.buyer.barangay].filter(Boolean).join(", ")}</p>
        {data.riderNotes && <p className="text-sm">Note: {data.riderNotes}</p>}
        {data.buyer.landmarkPhotoUrl && (
          // Private file served through our access check (only during this trip)
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.buyer.landmarkPhotoUrl} alt="Landmark near the buyer's house" className="rounded-md border max-h-48 w-fit" />
        )}
        <div className="flex gap-2 flex-wrap mt-1">
          {data.buyer.phone && <Button asChild variant="outline" size="sm"><a href={telLink(data.buyer.phone)}><PhoneIcon /> Call buyer</a></Button>}
          {data.conversationId && <Button variant="outline" size="sm" onClick={() => setShowChat((value) => !value)}>{showChat ? "Hide chat" : "Chat with buyer"}</Button>}
        </div>
      </div>
      {showChat && data.conversationId && (
        <div className="h-[420px] rounded-md border overflow-hidden">
          <ChatPanel key={data.conversationId} target={{ conversationId: data.conversationId }} />
        </div>
      )}
      {data.canDeliver && (
        <div className="rounded-md border-2 border-green-700 bg-green-50 p-3 flex flex-col gap-2">
          <p className="font-medium">Cash delivery fee collected (₱)</p>
          <input
            className="border rounded-md h-11 px-3 bg-white"
            inputMode="numeric"
            value={fee === "" ? String(data.fareEstimate ?? "") : fee}
            onChange={(event) => setFee(event.target.value.replace(/[^\d]/g, ""))}
          />
          <Button size="lg" className="bg-green-700 text-white" disabled={deliver.isPending} onClick={() => deliver.mutate({ orderId: data.orderId, feeCollected: Math.floor(feeValue) })}>
            Delivered ({formatCurrency(feeValue)} collected)
          </Button>
        </div>
      )}
    </section>
  );
};

const History = () => {
  const trpc = useTRPC();
  const history = useQuery(trpc.trips.history.queryOptions());
  if (!history.data || history.data.trips.length === 0) return null;
  return (
    <section className="rounded-md border bg-white p-4 flex flex-col gap-2">
      <div className="flex justify-between">
        <h2 className="font-medium">Trip history</h2>
        <span>Total: <strong>{formatCurrency(history.data.total)}</strong></span>
      </div>
      <ul className="text-sm divide-y">
        {history.data.trips.map((trip) => (
          <li key={trip.code} className="py-2 flex justify-between">
            <span>{trip.code} · {trip.barangay ?? ""} · {new Date(trip.deliveredAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" })}</span>
            <span>{formatCurrency(trip.fee)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

// Rider portal for APPROVED riders (CLAUDE.md §11.7): Active switch, requests, the trip, history
export const RiderDashboard = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.trips.status.queryOptions());
  const trip = useQuery({ ...trpc.trips.myTrip.queryOptions(), refetchInterval: whenVisible(15000) });
  const [switching, setSwitching] = useState(false);
  const setActive = useMutation(trpc.trips.setActive.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries(trpc.trips.pathFilter()),
    onError: (error) => toast.error(error.message),
  }));
  const isActive = Boolean(status.data?.isActive);
  useLocationSender(isActive);

  const toggle = async () => {
    setSwitching(true);
    try {
      if (isActive) await setActive.mutateAsync({ active: false });
      else await setActive.mutateAsync({ active: true, location: await getPosition() });
    } catch (error) {
      if (error instanceof Error && !("data" in error)) toast.error(error.message);
    } finally {
      setSwitching(false);
    }
  };

  if (!status.data) return <p className="p-4">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      {!status.data.hasPhone && <PhoneForm />}
      <div className={cn("rounded-md border-2 p-4 flex items-center justify-between gap-3", isActive ? "border-green-700 bg-green-50" : "bg-white")}>
        <div>
          <p className="text-lg font-semibold">{isActive ? "You're Active" : "You're off"}</p>
          <p className="text-sm text-neutral-600">{isActive ? "Buyers nearby can book you. Your location is shared while Active." : "Turn on to get ride requests."}</p>
        </div>
        <Button size="lg" disabled={switching || !status.data.hasPhone || (isActive && Boolean(trip.data))} onClick={toggle} className={isActive ? "" : "bg-black text-white"} variant={isActive ? "outline" : "default"}>
          {switching ? "…" : isActive ? "Go off" : "Go Active"}
        </Button>
      </div>
      <PushToggle />
      {trip.data ? <ActiveTrip /> : isActive ? <IncomingRequest /> : null}
      <History />
    </div>
  );
};
