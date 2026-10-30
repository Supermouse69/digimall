import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isValidEntryKey } from "@/modules/admin-security/server/two-factor";
import { AdminEntryView } from "@/modules/admin-security/ui/admin-entry-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ key: string }>;
}

// Hidden super-admin login (ADMIN_ENTRY_PATH). A wrong key looks exactly like any missing page.
const Page = async ({ params }: Props) => {
  const { key } = await params;
  if (!isValidEntryKey(decodeURIComponent(key))) notFound();
  return <AdminEntryView entryKey={decodeURIComponent(key)} />;
};

export default Page;
