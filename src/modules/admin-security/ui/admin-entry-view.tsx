"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Step =
  | { name: "login" }
  | { name: "setup"; ticket: string; qrDataUrl: string; manualKey: string }
  | { name: "backup-codes"; codes: string[]; redirectTo: string };

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <main className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
    <div className="max-w-md w-full bg-white border rounded-md p-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  </main>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1.5 text-sm font-medium">
    {label}
    {children}
  </label>
);

export const AdminEntryView = ({ entryKey }: { entryKey: string }) => {
  const trpc = useTRPC();
  const [step, setStep] = useState<Step>({ name: "login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [savedCodes, setSavedCodes] = useState(false);

  const goToAdmin = (redirectTo: string) => window.location.assign(redirectTo);

  const login = useMutation(trpc.adminEntry.login.mutationOptions({
    onError: (error) => toast.error(error.message),
    onSuccess: (result) => {
      setCode("");
      if (result.status === "setup_required") {
        setStep({ name: "setup", ticket: result.ticket, qrDataUrl: result.qrDataUrl, manualKey: result.manualKey });
        return;
      }
      if (result.backupCodesLeft <= 3) {
        toast.warning(`Only ${result.backupCodesLeft} backup codes left.`);
      }
      goToAdmin(result.redirectTo);
    },
  }));

  const confirm = useMutation(trpc.adminEntry.confirmSetup.mutationOptions({
    onError: (error) => toast.error(error.message),
    onSuccess: (result) => {
      setPassword("");
      setStep({ name: "backup-codes", codes: result.backupCodes, redirectTo: result.redirectTo });
    },
  }));

  if (step.name === "backup-codes") {
    return (
      <Card title="Save your backup codes">
        <p>
          If you lose your phone, each code below lets you log in <strong>once</strong>. Write them on paper or
          save them in a password manager. <strong>You won&apos;t see them again.</strong>
        </p>
        <ol className="grid grid-cols-2 gap-2 font-mono text-base bg-neutral-50 border rounded p-3">
          {step.codes.map((backupCode) => (
            <li key={backupCode}>{backupCode}</li>
          ))}
        </ol>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-black"
            checked={savedCodes}
            onChange={(event) => setSavedCodes(event.target.checked)}
          />
          <span>I saved these codes somewhere safe.</span>
        </label>
        <Button size="lg" disabled={!savedCodes} onClick={() => goToAdmin(step.redirectTo)}>
          Continue to admin
        </Button>
      </Card>
    );
  }

  if (step.name === "setup") {
    return (
      <Card title="Set up 2-step login">
        <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm">
          <li>Open your authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 2FAS).</li>
          <li>Add an account and scan this QR code.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        {/* Data URL generated on the server; next/image isn't needed for it */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.qrDataUrl} alt="QR code for your authenticator app" className="w-60 h-60 self-center border rounded" />
        <details className="text-sm">
          <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
          <code className="block mt-2 break-all bg-neutral-50 border rounded p-2">{step.manualKey}</code>
        </details>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            confirm.mutate({ key: entryKey, email, password, ticket: step.ticket, code });
          }}
        >
          <Field label="6-digit code">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          </Field>
          <Button type="submit" size="lg" disabled={confirm.isPending}>
            {confirm.isPending ? "Checking..." : "Turn on 2-step login"}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card title="Sign in">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ key: entryKey, email, password, code: code || undefined });
        }}
      >
        <Field label="Email">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </Field>
        <Field label="Code from your authenticator app (or a backup code)">
          <Input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" maxLength={11} />
        </Field>
        <p className="text-xs text-neutral-600">First time here? Leave the code empty — you&apos;ll set it up next.</p>
        <Button type="submit" size="lg" disabled={login.isPending}>
          {login.isPending ? "Checking..." : "Sign in"}
        </Button>
      </form>
    </Card>
  );
};
