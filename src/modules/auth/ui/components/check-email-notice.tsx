"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MailIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

interface Props {
  email: string;
}

// Shown after sign-up (and when an unconfirmed account tries to log in)
export const CheckEmailNotice = ({ email }: Props) => {
  const trpc = useTRPC();
  const [resent, setResent] = useState(false);
  const resend = useMutation(trpc.auth.resendVerification.mutationOptions({
    onSuccess: () => {
      setResent(true);
      toast.success("If your account still needs confirming, we sent a new link.");
    },
    onError: () => toast.error("Couldn't send right now. Please try again in a minute."),
  }));

  return (
    <div className="rounded-md border bg-white p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <MailIcon className="size-5" />
        <h2 className="text-xl font-medium">Check your email</h2>
      </div>
      <p>
        We sent a confirmation link to <strong className="break-all">{email}</strong>. Tap it to finish
        creating your account, then log in.
      </p>
      <p className="text-sm text-neutral-600">
        Can&apos;t find it? Check your Spam or Promotions folder. You can ask for a new link once a minute.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={resend.isPending || resent}
        onClick={() => resend.mutate({ email })}
      >
        {resend.isPending ? "Sending..." : resent ? "Link sent" : "Send the link again"}
      </Button>
    </div>
  );
};
