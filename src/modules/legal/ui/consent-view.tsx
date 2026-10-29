"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

interface Props {
  documents: { slug: string; title: string; version: number }[];
  redirectTo: string;
}

export const ConsentView = ({ documents, redirectTo }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);

  const accept = useMutation(trpc.auth.acceptConsents.mutationOptions({
    onError: (error) => toast.error(error.message),
    onSuccess: async () => {
      await queryClient.invalidateQueries(trpc.auth.session.queryFilter());
      if (redirectTo.startsWith("/admin")) {
        window.location.assign(redirectTo);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    },
  }));

  return (
    <main className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border rounded-md p-6 flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">We updated our terms</h1>
        <p className="text-neutral-700">Please read and agree to continue using DigiMall:</p>
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.slug}>
              <Link href={`/legal/${doc.slug}`} target="_blank" rel="noopener" className="underline font-medium">
                {doc.title}
              </Link>
              <span className="text-sm text-neutral-500"> (version {doc.version})</span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0 accent-black"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>I have read and agree to the documents above.</span>
        </label>
        <Button
          size="lg"
          variant="elevated"
          className="bg-black text-white hover:bg-pink-400 hover:text-primary"
          disabled={!accepted || accept.isPending}
          onClick={() => accept.mutate({ accept: accepted })}
        >
          {accept.isPending ? "Saving..." : "Agree and continue"}
        </Button>
      </div>
    </main>
  );
};
