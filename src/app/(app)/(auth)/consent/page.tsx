import { redirect } from "next/navigation";

import { homeForRole, safeRedirectPath } from "@/modules/auth/roles";
import { REQUIRED_DOCUMENTS } from "@/modules/legal/server/consents";
import { ConsentView } from "@/modules/legal/ui/consent-view";
import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

// Shown when the super-admin publishes a new version of a document the user must agree to.
const Page = async ({ searchParams }: Props) => {
  const { next: rawNext } = await searchParams;
  const next = safeRedirectPath(typeof rawNext === "string" ? rawNext : undefined, "");

  const session = await caller.auth.session();
  if (!session.user) redirect("/login?next=/consent");

  const redirectTo = homeForRole(session.user.role, next);
  if (!session.user.needsConsent) redirect(redirectTo);

  const documents = await Promise.all(
    REQUIRED_DOCUMENTS[session.user.role].map(async (slug) => {
      const page = await caller.legal.getOne({ slug });
      return { slug, title: page.title, version: page.version };
    }),
  );

  return <ConsentView documents={documents} redirectTo={redirectTo} />;
};

export default Page;
