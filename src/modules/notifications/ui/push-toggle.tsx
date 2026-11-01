"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BellIcon, BellOffIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

// "Turn on notifications" for this phone/browser (CLAUDE.md §11.12).
// Android: works in the browser. iPhone: only after "Add to Home Screen" (Apple's rule).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const toUint8Array = (base64: string) => {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

type State = "unsupported" | "denied" | "off" | "on" | "loading";

const readState = async (): Promise<State> => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
};

export const PushToggle = ({ className }: { className?: string }) => {
  const trpc = useTRPC();
  const [state, setState] = useState<State>("loading");
  const subscribe = useMutation(trpc.notifications.subscribe.mutationOptions());
  const unsubscribe = useMutation(trpc.notifications.unsubscribe.mutationOptions());

  useEffect(() => {
    let alive = true;
    void readState().then((value) => alive && setState(value));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    try {
      setState("loading");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8Array(VAPID_PUBLIC_KEY!) }));
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribe.mutateAsync({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
      setState("on");
      toast.success("Notifications are on for this phone");
    } catch {
      setState("off");
      toast.error("Couldn't turn on notifications on this phone.");
    }
  };

  const turnOff = async () => {
    setState("loading");
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await unsubscribe.mutateAsync({ endpoint: subscription.endpoint }).catch(() => undefined);
      await subscription.unsubscribe();
    }
    setState("off");
  };

  if (state === "unsupported") {
    return (
      <p className={className ?? "text-sm text-neutral-600"}>
        Notifications aren&apos;t available in this browser. On iPhone: Share → &quot;Add to Home Screen&quot;, then open DigiMall from there.
      </p>
    );
  }
  if (state === "denied") {
    return <p className={className ?? "text-sm text-neutral-600"}>Notifications are blocked. Allow them for this site in your browser settings.</p>;
  }
  return state === "on" ? (
    <Button variant="outline" size="sm" className={className} onClick={turnOff}>
      <BellOffIcon /> Turn off notifications
    </Button>
  ) : (
    <Button variant="outline" size="sm" className={className} disabled={state === "loading"} onClick={turnOn}>
      <BellIcon /> Turn on notifications
    </Button>
  );
};
