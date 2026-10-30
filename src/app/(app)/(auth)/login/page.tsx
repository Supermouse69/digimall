import { redirect } from "next/navigation";

import { SignInView } from "@/modules/auth/ui/views/sign-in-view";
import { homeForRole, safeRedirectPath } from "@/modules/auth/roles";
import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ next?: string | string[]; verified?: string; reset?: string }>;
}

// One login page for buyers, sellers and riders; the server sends each role to its own home.
const Page = async ({ searchParams }: Props) => {
  const { next: rawNext, verified, reset } = await searchParams;
  const notice = verified ? "verified" : reset ? "reset" : undefined;
  const next = safeRedirectPath(typeof rawNext === "string" ? rawNext : undefined, "");

  const session = await caller.auth.session();
  if (session.user) {
    redirect(homeForRole(session.user.role, next));
  }

  return <SignInView next={next || undefined} notice={notice} />;
};

export default Page;
