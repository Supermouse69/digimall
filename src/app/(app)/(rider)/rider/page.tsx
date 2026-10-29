import Link from "next/link";
import { redirect } from "next/navigation";

import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

// Placeholder until the rider portal is built (Phase 6). Riders only — checked on the server.
const Page = async () => {
  const session = await caller.auth.session();
  if (!session.user) redirect("/login?next=/rider");
  if (session.user.role !== "rider") redirect("/");

  return (
    <main className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border rounded-md p-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Hi, {session.user.name.split(" ")[0]}!</h1>
        <p className="text-neutral-700">
          The rider portal is coming soon. You&apos;ll be able to go Active, get ride requests,
          and see your trips here.
        </p>
        <Link href="/" className="underline font-medium">
          Back to DigiMall
        </Link>
      </div>
    </main>
  );
};

export default Page;
