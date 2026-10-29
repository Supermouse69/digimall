import { redirect } from "next/navigation";

import { SignUpView } from "@/modules/auth/ui/views/sign-up-view";
import { homeForRole, safeRedirectPath } from "@/modules/auth/roles";
import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

const Page = async ({ searchParams }: Props) => {
  const { next: rawNext } = await searchParams;
  const next = safeRedirectPath(typeof rawNext === "string" ? rawNext : undefined, "");

  const session = await caller.auth.session();
  if (session.user) {
    redirect(homeForRole(session.user.role, next));
  }

  // Barangays, map center, minimum age, key points and legal links all come from Settings
  const options = await caller.settings.signupOptions();

  return <SignUpView next={next || undefined} options={options} />;
};

export default Page;
