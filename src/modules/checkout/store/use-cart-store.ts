import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// The cart lives in the browser (no account needed to fill it). Grouped by store, with a quantity
// per product. The server re-checks everything at checkout (prices, availability, max stores).
export const MAX_QTY = 20;

type StoreCart = { items: Record<string, number> }; // productId -> quantity

interface CartState {
  carts: Record<string, StoreCart>; // storeSlug -> cart
  add: (storeSlug: string, productId: string, maxStores: number) => "added" | "too_many_stores";
  setQty: (storeSlug: string, productId: string, qty: number) => void;
  remove: (storeSlug: string, productId: string) => void;
  clearStore: (storeSlug: string) => void;
  clearAll: () => void;
}

const withoutEmpty = (carts: Record<string, StoreCart>) =>
  Object.fromEntries(Object.entries(carts).filter(([, cart]) => Object.keys(cart.items).length > 0));

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      carts: {},
      add: (storeSlug, productId, maxStores) => {
        const { carts } = get();
        if (!carts[storeSlug] && Object.keys(carts).length >= maxStores) return "too_many_stores";
        const items = carts[storeSlug]?.items ?? {};
        set({ carts: { ...carts, [storeSlug]: { items: { ...items, [productId]: Math.min((items[productId] ?? 0) + 1, MAX_QTY) } } } });
        return "added";
      },
      setQty: (storeSlug, productId, qty) =>
        set(({ carts }) => {
          const items = { ...(carts[storeSlug]?.items ?? {}) };
          if (qty <= 0) delete items[productId];
          else items[productId] = Math.min(Math.floor(qty), MAX_QTY);
          return { carts: withoutEmpty({ ...carts, [storeSlug]: { items } }) };
        }),
      remove: (storeSlug, productId) => get().setQty(storeSlug, productId, 0),
      clearStore: (storeSlug) =>
        set(({ carts }) => {
          const next = { ...carts };
          delete next[storeSlug];
          return { carts: next };
        }),
      clearAll: () => set({ carts: {} }),
    }),
    // New name: the tutorial's old cart (no quantities) is simply left behind
    { name: "digimall-cart-v2", storage: createJSONStorage(() => localStorage) },
  ),
);

export const cartItemCount = (carts: Record<string, StoreCart>) =>
  Object.values(carts).reduce((sum, cart) => sum + Object.values(cart.items).reduce((a, b) => a + b, 0), 0);
