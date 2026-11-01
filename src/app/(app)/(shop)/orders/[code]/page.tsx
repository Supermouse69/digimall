import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth/server/require-user";
import { isOrderCode } from "@/modules/orders/state";
import { OrderDetailView } from "@/modules/orders/ui/order-detail-view";

export const dynamic = "force-dynamic";

const Page = async ({ params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const upper = decodeURIComponent(code).toUpperCase();
  if (!isOrderCode(upper)) notFound();
  await requireUser(["buyer"], `/orders/${upper}`);
  return <OrderDetailView code={upper} />;
};

export default Page;
