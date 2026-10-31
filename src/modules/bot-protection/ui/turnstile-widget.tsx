"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Cloudflare Turnstile widget ("I'm not a robot" check; usually passes on its own without a click).
// Each token works ONCE, so call reset() after every submit, whether it worked or not.

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      size?: "normal" | "flexible" | "compact";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")));
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next render
      script.remove();
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
};

export const useTurnstile = () => {
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken("");
    setResetKey((key) => key + 1);
  }, []);
  return { token, reset, widgetProps: { onToken: setToken, resetKey } };
};

interface Props {
  onToken: (token: string) => void;
  resetKey: number;
}

export const TurnstileWidget = ({ onToken, resetKey }: Props) => {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
        });
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("failed"));
    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  // A new check after every submit (tokens work once)
  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }, [resetKey]);

  if (!siteKey) {
    return <p className="text-sm text-red-600">The robot check isn&apos;t set up (NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing).</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div ref={containerRef} className="min-h-[65px]" />
      {status === "failed" && (
        <p className="text-sm text-red-600">
          Couldn&apos;t load the robot check. Check your internet connection, then reload the page.
        </p>
      )}
    </div>
  );
};
