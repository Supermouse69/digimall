"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlagIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REPORT_REASONS, type ReportTarget } from "../reasons";

interface Props {
  targetType: ReportTarget;
  targetId: string;
}

// Small "Report" link + an in-page dialog (CLAUDE.md §11.3: never browser alert/confirm).
// Logged-out visitors are sent to log in first.
export const ReportButton = ({ targetType, targetId }: Props) => {
  const trpc = useTRPC();
  const pathname = usePathname();
  const session = useQuery(trpc.auth.session.queryOptions());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");

  const report = useMutation(trpc.reports.create.mutationOptions({
    onSuccess: () => {
      toast.success("Thanks for reporting. We'll look into it.");
      setOpen(false);
      setReason("");
      setNote("");
    },
    onError: (error) =>
      toast.error(error.data?.code === "INTERNAL_SERVER_ERROR" ? "Couldn't send the report. Please try again." : error.message),
  }));

  const label = targetType === "product" ? "Report this product" : targetType === "store" ? "Report this store" : "Report this chat";

  if (!session.data?.user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="inline-flex items-center gap-1 text-sm text-neutral-600 underline w-fit"
      >
        <FlagIcon className="size-3.5" /> {label}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm text-neutral-600 underline w-fit"
      >
        <FlagIcon className="size-3.5" /> {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {targetType === "conversation"
                ? "The DigiMall admin will be able to read this chat to check it. It won't be auto-deleted until the report is handled."
                : "Only the DigiMall admin sees reports. The store won't know who reported."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason) return;
              report.mutate({ targetType, targetId, reason, note: note.trim() || undefined });
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium mb-1">What&apos;s wrong?</legend>
              {REPORT_REASONS.map((option) => (
                <label key={option.value} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:checked]:border-black">
                  <input
                    type="radio"
                    name="reason"
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="mt-0.5 size-4 accent-black"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Details (optional)</span>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} />
            </label>
            <Button type="submit" disabled={!reason || report.isPending} className="bg-black text-white">
              {report.isPending ? "Sending..." : "Send report"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
