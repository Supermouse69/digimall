import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { caller } from "@/trpc/server";

// Buyer-site layouts call this: logged-in users who haven't agreed to the latest
// Terms/Privacy version are sent to /consent first. (Logged-out visitors can browse.)
export const requireCurrentConsent = async () => {
  // The answer depends on the visitor's login cookie, so these pages can't be pre-built as static
  await connection();

  const session = await caller.auth.session();
  if (session.user?.needsConsent) redirect("/consent");
};
