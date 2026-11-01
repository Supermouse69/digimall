"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import type { LatLng } from "@/lib/geo";
import type { DeliveryMode } from "@/modules/orders/state";

import { useCartStore } from "../../store/use-cart-store";

// Leaflet needs the browser (window), so the map loads only on the client
const LocationPicker = dynamic(() => import("@/components/map/location-picker"), {
  ssr: false,
  loading: () => <div className="h-72 rounded-md border bg-neutral-100 animate-pulse" />,
});

// Checkout (CLAUDE.md §11.4): mode, delivery pin, notes, fare estimate, key points. Everything is
// checked again on the server when the order is placed.
export const CheckoutView = () => {
  const trpc = useTRPC();
  const router = useRouter();
  const { carts, clearStore } = useCartStore();
  const [mode, setMode] = useState<DeliveryMode>("casual");
  const [barangay, setBarangay] = useState<string | undefined>();
  const [addressDetails, setAddressDetails] = useState<string | undefined>();
  const [location, setLocation] = useState<LatLng | undefined>();
  const [storeNotes, setStoreNotes] = useState<Record<string, string>>({});
  const [riderNotes, setRiderNotes] = useState("");

  const stores = Object.entries(carts).map(([storeSlug, cart]) => ({
    storeSlug,
    items: Object.entries(cart.items).map(([productId, qty]) => ({ productId, qty })),
    note: storeNotes[storeSlug] || undefined,
  }));
  const delivery = { barangay, addressDetails, location };
  const preview = useQuery({
    // Notes don't change the preview, so they're left out (no refetch while typing)
    ...trpc.orders.preview.queryOptions({ stores: stores.map((store) => ({ storeSlug: store.storeSlug, items: store.items })), mode, delivery }),
    enabled: stores.length > 0,
    retry: false,
  });
  const options = useQuery(trpc.settings.cartOptions.queryOptions());

  const place = useMutation(trpc.orders.place.mutationOptions({
    onSuccess: ({ code }) => {
      for (const store of stores) clearStore(store.storeSlug);
      toast.success(`Order ${code} placed`);
      router.push(`/orders/${code}`);
    },
    onError: (error) => toast.error(error.data?.code === "INTERNAL_SERVER_ERROR" ? "Couldn't place the order. Please try again." : error.message),
  }));

  if (stores.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center flex flex-col gap-4 items-center">
        <p>Your cart is empty.</p>
        <Link href="/" className="underline">Browse stores</Link>
      </div>
    );
  }
  if (preview.isError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center flex flex-col gap-4 items-center">
        <p className="text-red-600">{preview.error.message}</p>
        <Link href="/cart" className="underline">Back to cart</Link>
      </div>
    );
  }
  const data = preview.data;
  const point = location ?? data?.delivery.location ?? undefined;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 className="text-3xl font-medium">Checkout</h1>

      <section className="rounded-md border bg-white p-4 flex flex-col gap-3">
        <h2 className="text-xl font-medium">Delivery</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Delivery mode">
          {(["casual", "fast"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn("rounded-md border p-3 text-left", mode === value && "border-black ring-2 ring-black")}
            >
              <span className="font-medium">{value === "fast" ? "🔴 Fast" : "🟢 Casual"}</span>
              <span className="block text-sm text-neutral-600">{value === "fast" ? "Urgent, higher fare" : "Normal, cheaper"}</span>
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Barangay</span>
          <select
            className="border rounded-md h-11 px-2 bg-white"
            value={barangay ?? data?.delivery.barangay ?? ""}
            onChange={(event) => setBarangay(event.target.value)}
          >
            <option value="" disabled>Pick your barangay</option>
            {data?.barangays.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Street / purok / house details</span>
          <input
            className="border rounded-md h-11 px-3"
            maxLength={200}
            value={addressDetails ?? data?.delivery.addressDetails ?? ""}
            onChange={(event) => setAddressDetails(event.target.value)}
          />
        </label>
        {data && (
          <div className="flex flex-col gap-1">
            <span className="font-medium">Delivery pin</span>
            <LocationPicker center={data.serviceCenter} radiusKm={data.serviceRadiusKm} value={point ?? null} onChange={setLocation} />
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Note for the rider (optional)</span>
          <Textarea value={riderNotes} onChange={(event) => setRiderNotes(event.target.value)} maxLength={500} rows={2} placeholder="e.g. blue gate beside the sari-sari store" />
        </label>
      </section>

      {data?.stores.map((store) => (
        <section key={store.storeSlug} className="rounded-md border bg-white">
          <h2 className="px-4 py-3 border-b font-medium">{store.storeName}</h2>
          <ul className="px-4 py-2">
            {store.lines.map((line) => (
              <li key={line.productId} className="flex justify-between py-1">
                <span>{line.qty} × {line.name}</span>
                <span>{formatCurrency(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
          {store.problems.map((problem) => <p key={problem} className="px-4 text-sm text-red-600">{problem}</p>)}
          <div className="px-4 pb-3 flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor={`note-${store.storeSlug}`}>Note for {store.storeName} (optional)</label>
            <Textarea
              id={`note-${store.storeSlug}`}
              value={storeNotes[store.storeSlug] ?? ""}
              onChange={(event) => setStoreNotes((notes) => ({ ...notes, [store.storeSlug]: event.target.value }))}
              maxLength={500}
              rows={2}
            />
          </div>
          <p className="px-4 py-3 border-t text-right">Pay this store: <strong>{formatCurrency(store.subtotal)}</strong> (GCash)</p>
        </section>
      ))}

      {(options.data?.checkoutKeyPoints.length ?? 0) > 0 && (
        <section className="rounded-md border border-amber-500 bg-amber-50 p-4">
          <h2 className="font-medium mb-2">Quick reminders</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-sm">
            {options.data!.checkoutKeyPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded-md border bg-white p-4 flex flex-col gap-2">
        <h2 className="text-xl font-medium">Order Summary</h2>
        <p className="flex justify-between"><span>Items (paid to each store by GCash)</span><strong>{formatCurrency(data?.itemsTotal ?? 0)}</strong></p>
        <p className="flex justify-between">
          <span>Estimated delivery fee (cash to the rider)</span>
          <strong>{data?.fare.estimate != null ? formatCurrency(data.fare.estimate) : "Rider will tell you"}</strong>
        </p>
        {data && data.fare.extraStops > 0 && data.fare.extraStopFee > 0 && (
          <p className="text-sm text-neutral-600">Includes {formatCurrency(data.fare.extraStopFee)} for each extra store stop.</p>
        )}
        <p className="text-sm text-neutral-600">No convenience fee during the beta. Order Summary — not an official receipt/invoice.</p>
        {data?.problems.map((problem) => <p key={problem} className="text-sm text-red-600">{problem}</p>)}
        <Button
          size="lg"
          className="bg-black text-white mt-2"
          disabled={!data || data.problems.length > 0 || place.isPending}
          onClick={() => place.mutate({ stores, mode, delivery, riderNotes: riderNotes.trim() || undefined })}
        >
          {place.isPending ? "Placing order..." : "Place order"}
        </Button>
        <p className="text-xs text-neutral-600">
          Each store confirms first. Then you pay that store by GCash and send the receipt. <Link href="/cart" className="underline">Back to cart</Link>
        </p>
      </section>
    </div>
  );
};
