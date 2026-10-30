import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/modules/auth/ui/components/auth-card";
import { verifyEmailSchema } from "@/modules/auth/schemas";
import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ token?: string | string[] }>;
}

// Opened from the confirmation email
const Page = async ({ searchParams }: Props) => {
  const { token } = await searchParams;
  const parsed = verifyEmailSchema.safeParse({ token });

  const verified = parsed.success
    ? await caller.auth.verifyEmail(parsed.data).then(
        () => true,
        () => false,
      )
    : false;

  if (verified) redirect("/login?verified=1");

  return (
    <AuthCard title="This link didn't work">
      <p>It may have been used already, or copied incorrectly.</p>
      <p>
        If your email is already confirmed, just{" "}
        <Link href="/login" className="underline font-medium">log in</Link>. Otherwise, try logging in and
        we&apos;ll offer to send a new link.
      </p>
    </AuthCard>
  );
};

export default Page;
