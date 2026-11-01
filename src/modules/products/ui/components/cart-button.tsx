import Link from "next/link";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCart } from "@/modules/checkout/hooks/use-cart";

interface Props {
  tenantSlug: string;
  productId: string;
}

export const CartButton = ({ tenantSlug, productId }: Props) => {
  const cart = useCart(tenantSlug);
  const qty = cart.qtyOf(productId);

  if (qty > 0) {
    return (
      <div className="flex-1 flex gap-2">
        <Button asChild variant="elevated" className="flex-1 bg-white">
          <Link href="/cart">In cart ({qty}) · View cart</Link>
        </Button>
        <Button variant="elevated" className="bg-white" onClick={() => cart.remove(productId)}>
          Remove
        </Button>
      </div>
    );
  }
  return (
    <Button
      variant="elevated"
      className={cn("flex-1 bg-pink-400")}
      onClick={() => {
        if (cart.add(productId)) toast.success("Added to cart");
      }}
    >
      Add to cart
    </Button>
  );
};
