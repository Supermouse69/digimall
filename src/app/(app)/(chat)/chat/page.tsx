import { redirect } from "next/navigation";
import { headers as getHeaders } from "next/headers";
import { getPayload } from "payload";
import config from "@payload-config";

import { chatActorFor } from "@/modules/chat/server/chat-service";
import type { User } from "@/payload-types";

import { FullPageChat } from "./full-page-chat";

export const dynamic = "force-dynamic";

// Full-page chat: used on its own, and inside the seller's chat head in the Payload admin
// (?embed=1, shown in a frame). Buyers and sellers only, checked on the server.
const Page = async ({ searchParams }: { searchParams: Promise<{ embed?: string }> }) => {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await getHeaders() });
  if (!user || user.collection !== "users") redirect("/login?next=/chat");
  if (!chatActorFor(user as User)) redirect("/");
  const { embed } = await searchParams;
  return <FullPageChat embedded={embed === "1"} />;
};

export default Page;
