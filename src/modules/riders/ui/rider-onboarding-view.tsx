"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/modules/auth/hooks/use-logout";

const MAX_BYTES = 5 * 1024 * 1024;

type DocumentField = "photo" | "licenseDocument" | "franchiseDocument";
type Purpose = "rider-photo" | "rider-license" | "rider-franchise";

const DOCUMENTS: { field: DocumentField; purpose: Purpose; title: string; hint: string; urlKey: "photoUrl" | "licenseUrl" | "franchiseUrl" }[] = [
  { field: "photo", purpose: "rider-photo", title: "Your photo", hint: "A clear photo of your face. Buyers see it when they book you.", urlKey: "photoUrl" },
  { field: "licenseDocument", purpose: "rider-license", title: "Driver's license (LTO)", hint: "Front of your valid license. Only the DigiMall admin can see it.", urlKey: "licenseUrl" },
  { field: "franchiseDocument", purpose: "rider-franchise", title: "Tricycle franchise / permit (MTOP)", hint: "Your LGU franchise or permit. Only the DigiMall admin can see it.", urlKey: "franchiseUrl" },
];

const STATUS_TEXT = {
  pending: { label: "Waiting for approval", tone: "bg-amber-50 border-amber-500", note: "Upload all 3 below. The admin checks them before you can take rides." },
  approved: { label: "Approved", tone: "bg-green-50 border-green-600", note: "You're approved! Ride requests come in Phase 6 of the app." },
  suspended: { label: "Suspended", tone: "bg-red-50 border-red-600", note: "Your account is on hold. Please contact the DigiMall admin." },
} as const;

// Uploads to our private file storage (owner = this rider, set by the server)
const uploadPrivateFile = async (file: File, purpose: Purpose): Promise<string> => {
  const body = new FormData();
  body.append("file", file);
  body.append("_payload", JSON.stringify({ purpose }));
  const res = await fetch("/api/private-media", { method: "POST", body, credentials: "include" });
  const json = (await res.json().catch(() => null)) as { doc?: { id: string }; errors?: { message?: string }[] } | null;
  if (!res.ok || !json?.doc?.id) {
    throw new Error(json?.errors?.[0]?.message ?? "Upload failed. Please try again.");
  }
  return json.doc.id;
};

const DocumentCard = ({
  doc,
  currentUrl,
}: {
  doc: (typeof DOCUMENTS)[number];
  currentUrl: string | null;
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const attach = useMutation(trpc.riders.attachDocument.mutationOptions());

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Please use a JPG, PNG, or WebP photo.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That photo is over 5 MB. Please take a smaller one.");
      return;
    }
    setBusy(true);
    try {
      const fileId = await uploadPrivateFile(file, doc.purpose);
      await attach.mutateAsync({ field: doc.field, fileId });
      await queryClient.invalidateQueries(trpc.riders.myProfile.queryFilter());
      toast.success(`${doc.title} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="bg-white border rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{doc.title}</h2>
        {currentUrl && <CheckCircle2Icon className="size-5 text-green-600 shrink-0" aria-label="Uploaded" />}
      </div>
      <p className="text-sm text-neutral-600">{doc.hint}</p>
      {currentUrl && (
        // Private file served through our access check; next/image can't fetch it with the login cookie
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt={doc.title} className="w-full max-h-48 object-contain rounded border bg-neutral-50" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => inputRef.current?.click()}>
        <UploadIcon />
        {busy ? "Uploading..." : currentUrl ? "Replace photo" : "Upload photo"}
      </Button>
    </div>
  );
};

export const RiderOnboardingView = () => {
  const trpc = useTRPC();
  const { data: profile } = useSuspenseQuery(trpc.riders.myProfile.queryOptions());
  const logout = useLogout();
  const status = STATUS_TEXT[profile.status];

  return (
    <main className="min-h-screen bg-[#F4F4F0]">
      <div className="max-w-md mx-auto p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-xl">DigiMall Rider</span>
          <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Log out
          </Button>
        </div>
        <h1 className="text-2xl font-semibold">Hi, {profile.displayName.split(" ")[0]}!</h1>
        <div className={`border rounded-md p-4 ${status.tone}`}>
          <p className="font-medium">{status.label}</p>
          <p className="text-sm">{status.note}</p>
        </div>
        {profile.status !== "suspended" &&
          DOCUMENTS.map((doc) => <DocumentCard key={doc.field} doc={doc} currentUrl={profile[doc.urlKey]} />)}
        {profile.status === "approved" && (
          <p className="text-sm text-neutral-600">
            If you replace your license or MTOP, the admin will check it again before you can ride.
          </p>
        )}
      </div>
    </main>
  );
};
