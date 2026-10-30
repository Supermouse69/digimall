import Link from "next/link";

import { AuthCard } from "@/modules/auth/ui/components/auth-card";
import { ResetPasswordView } from "@/modules/auth/ui/views/reset-password-view";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ token?: string | string[] }>;
}

// Opened from the password reset email. The token is checked on the server when the form is sent.
const Page = async ({ searchParams }: Props) => {
  const { token } = await searchParams;

  if (typeof token !== "string" || !/^[a-zA-Z0-9]{20,128}$/.test(token)) {
    return (
      <AuthCard title="This link didn't work">
        <p>It may have expired or been copied incorrectly.</p>
        <Link href="/forgot-password" className="underline font-medium w-fit">Ask for a new link</Link>
      </AuthCard>
    );
  }

  return <ResetPasswordView token={token} />;
};

export default Page;
