"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@payloadcms/ui";

// Sellers' chat head inside the Payload admin panel (developer's choice: a floating chat like
// other shopping apps, no separate page to go to). It shows the same chat as the buyer site
// (/chat?embed=1) in a frame, so there is one chat screen to maintain.
// Inline styles: the admin panel doesn't load the site's Tailwind CSS.

const POLL_MS = 20000;

const readUnread = async (): Promise<number> => {
  try {
    const res = await fetch("/api/trpc/chat.unreadCount", { credentials: "include" });
    const json = (await res.json()) as { result?: { data?: { count?: number } } };
    return json.result?.data?.count ?? 0;
  } catch {
    return 0;
  }
};

const SellerChatBubble = () => {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const count = await readUnread();
      if (alive) setUnread(count);
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  // The chat inside the frame asks to close itself
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data === "digimall-chat-close") setOpen(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <>
      {open && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 88,
            width: "min(380px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 120px))",
            zIndex: 1000,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            border: "1px solid #ddd",
            background: "#fff",
          }}
        >
          <iframe src="/chat?embed=1" title="Chats" style={{ width: "100%", height: "100%", border: 0 }} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Chats, ${unread} new` : "Chats"}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#000",
          color: "#fff",
          border: 0,
          cursor: "pointer",
          zIndex: 1001,
          fontSize: 24,
          boxShadow: "0 4px 12px rgba(0,0,0,.3)",
        }}
      >
        💬
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              padding: "0 4px",
              borderRadius: 10,
              background: "#ec4899",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: "20px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
};

// Payload admin "provider": wraps every admin page; shows the bubble only for sellers with a store
export const SellerChatHead = ({ children }: { children?: React.ReactNode }) => {
  const { user } = useAuth();
  const isSellerWithStore =
    (user as { role?: string } | null)?.role === "seller" &&
    ((user as { tenants?: unknown[] } | null)?.tenants?.length ?? 0) > 0;
  return (
    <>
      {children}
      {isSellerWithStore && <SellerChatBubble />}
    </>
  );
};

export default SellerChatHead;
