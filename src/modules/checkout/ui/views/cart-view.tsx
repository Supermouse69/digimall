"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MinusIcon, PlusIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { formatCurrency, generateTenantURL } from "@/lib/utils";

import { MAX_QTY, useCartStore } from "../../store/use-cart-store";

// The cart, grouped by store (CLAUDE.md §11.4). Prices shown here are a preview; the server
// re-checks them at checkout.
export const CartView = () => {
  const trpc = useTRPC();
  const { carts, setQty, remove, clearStore } = useCartStore();
  const ids = Object.values(carts).flatMap((cart) => Object.keys(cart.items));
  const details = useQuery({ ...trpc.products.cartDetails.queryOptions({ ids }), enabled: ids.length > 0 });
  const byId = new Map((details.data ?? []).map((product) => [product.id, product]));

  if (ids.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 flex flex-col items-center gap-4 text-center">
        <ShoppingCartIcon className="size-10" />
        <h1 className="text-2xl font-medium">Your cart is empty</h1>
        <Button asChild variant="elevated" className="bg-white">
          <Link href="/">Browse stores</Link>
        </Button>
      </div>
    );
  }

  let total = 0;
  let hasProblem = false;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 className="text-3xl font-medium">Cart</h1>
      {Object.entries(carts).map(([storeSlug, cart]) => {
        const lines = Object.entries(cart.items).map(([productId, qty]) => ({ productId, qty, product: byId.get(productId) }));
        const storeName = lines.find((line) => line.product)?.product?.storeName ?? storeSlug;
        const subtotal = lines.reduce((sum, line) => sum + (line.product?.isAvailable ? line.product.price * line.qty : 0), 0);
        total += subtotal;
        return (
          <section key={storeSlug} className="rounded-md border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <Link href={generateTenantURL(storeSlug)} className="font-medium underline">
                {storeName}
              </Link>
              <button type="button" className="text-sm text-neutral-600 underline" onClick={() => clearStore(storeSlug)}>
                Remove store
              </button>
            </div>
            <ul>
              {lines.map(({ productId, qty, product }) => {
                const gone = details.isSuccess && !product;
                const unavailable = product && !product.isAvailable;
                if (gone || unavailable) hasProblem = true;
                return (
                  <li key={productId} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
                    <div className="relative size-14 shrink-0 rounded border overflow-hidden bg-neutral-50">
                      {product?.imageUrl && <Image src={product.imageUrl} alt={product.name} fill sizes="56px" className="object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{product?.name ?? (gone ? "No longer sold" : "Loading…")}</p>
                      {product && <p className="text-sm">{formatCurrency(product.price)}</p>}
                      {unavailable && <p className="text-sm text-red-600">Not available right now. Remove it to check out.</p>}
                      {gone && <p className="text-sm text-red-600">This item was removed by the store. Remove it to check out.</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" aria-label="Less" onClick={() => setQty(storeSlug, productId, qty - 1)}>
                        <MinusIcon />
                      </Button>
                      <span className="w-6 text-center">{qty}</span>
                      <Button variant="ghost" size="icon" aria-label="More" disabled={qty >= MAX_QTY} onClick={() => setQty(storeSlug, productId, qty + 1)}>
                        <PlusIcon />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => remove(storeSlug, productId)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="px-4 py-3 border-t text-right">
              Subtotal: <strong>{formatCurrency(subtotal)}</strong>
            </p>
          </section>
        );
      })}
      <div className="rounded-md border bg-white p-4 flex flex-col gap-3">
        <p className="flex justify-between text-lg">
          <span>Items total</span>
          <strong>{formatCurrency(total)}</strong>
        </p>
        <p className="text-sm text-neutral-600">
          You pay each store separately by GCash after it confirms. The delivery fee is paid in cash to your rider.
        </p>
        <Button asChild={!hasProblem} disabled={hasProblem} size="lg" className="bg-black text-white">
          {hasProblem ? <span>Fix the items above to check out</span> : <Link href="/checkout">Check out</Link>}
        </Button>
      </div>
    </div>
  );
};
