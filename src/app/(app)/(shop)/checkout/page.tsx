import { requireUser } from "@/modules/auth/server/require-user";
import { CheckoutView } from "@/modules/checkout/ui/views/checkout-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout · DigiMall" };

// Checkout needs a logged-in buyer (CLAUDE.md §11.4)
const Page = async () => {
  await requireUser(["buyer"], "/checkout");
  return <CheckoutView />;
};

export default Page;
