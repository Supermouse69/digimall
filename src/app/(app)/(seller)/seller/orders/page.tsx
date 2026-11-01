import { requireUser } from "@/modules/auth/server/require-user";
import { SellerBoardView } from "@/modules/orders/ui/seller-board-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders · DigiMall" };

// Sellers' Orders board (also shown inside the admin panel, ?embed=1)
const Page = async ({ searchParams }: { searchParams: Promise<{ embed?: string }> }) => {
  await requireUser(["seller"], "/seller/orders");
  const { embed } = await searchParams;
  return <SellerBoardView embedded={embed === "1"} />;
};

export default Page;
