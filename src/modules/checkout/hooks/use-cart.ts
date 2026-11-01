import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";

import { cartItemCount, useCartStore } from "../store/use-cart-store";

// Cart helpers for one store's product buttons
export const useCart = (storeSlug: string) => {
  const trpc = useTRPC();
  const options = useQuery(trpc.settings.cartOptions.queryOptions());
  const maxStores = options.data?.maxStoresPerCart ?? 3;
  const { carts, add, remove } = useCartStore();
  const items = carts[storeSlug]?.items ?? {};

  return {
    qtyOf: (productId: string) => items[productId] ?? 0,
    add: (productId: string) => {
      if (add(storeSlug, productId, maxStores) === "too_many_stores") {
        toast.error(`You can order from up to ${maxStores} stores at a time. Check out first, or remove a store from your cart.`);
        return false;
      }
      return true;
    },
    remove: (productId: string) => remove(storeSlug, productId),
    totalItems: cartItemCount(carts),
  };
};
