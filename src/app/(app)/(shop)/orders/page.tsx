import { requireUser } from "@/modules/auth/server/require-user";
import { MyOrdersView } from "@/modules/orders/ui/my-orders-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "My orders · DigiMall" };

const Page = async () => {
  await requireUser(["buyer"], "/orders");
  return <MyOrdersView />;
};

export default Page;
