import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { cartItemCount, useCartStore } from "../../store/use-cart-store";

// Cart icon with the number of items across all stores
export const CheckoutButton = ({ className, hideIfEmpty }: { className?: string; hideIfEmpty?: boolean; tenantSlug?: string }) => {
  const totalItems = useCartStore((state) => cartItemCount(state.carts));
  if (hideIfEmpty && totalItems === 0) return null;
  return (
    <Button variant="elevated" asChild className={cn("bg-white", className)}>
      <Link href="/cart" aria-label={`Cart, ${totalItems} items`}>
        <ShoppingCartIcon /> {totalItems > 0 ? totalItems : ""}
      </Link>
    </Button>
  );
};
