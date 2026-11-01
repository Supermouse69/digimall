"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@payloadcms/ui";

// Sellers' floating bubbles inside the Payload admin panel (developer's choice: like other
// shopping apps, no separate page to go to):
//   💬 Chats  -> /chat?embed=1           (store chat)
//   📦 Orders -> /seller/orders?embed=1  (Orders board, Phase 5)
// Each opens the main site's page in a frame, so there's one chat/order screen to maintain.
// Inline styles: the admin panel doesn't load the site's Tailwind CSS.

const POLL_MS = 20000;

const readCount = async (path: string): Promise<number> => {
  try {
    const res = await fetch(path, { credentials: "include" });
    const json = (await res.json()) as { result?: { data?: { count?: number } } };
    return json.result?.data?.count ?? 0;
  } catch {
    return 0;
  }
};

type BubbleProps = {
  icon: string;
  label: string;
  src: string;
  countPath: string;
  closeMessage: string;
  bottom: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
};

const FrameBubble = ({ icon, label, src, countPath, closeMessage, bottom, open, onToggle, onClose }: BubbleProps) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const value = await readCount(countPath);
      if (alive) setCount(value);
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [countPath, open]);

  // The page inside the frame asks to close itself
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data === closeMessage) onClose();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [closeMessage, onClose]);

  return (
    <>
      {open && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 160,
            width: "min(420px, calc(100vw - 32px))",
            height: "min(600px, calc(100vh - 190px))",
            zIndex: 1000,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            border: "1px solid #ddd",
            background: "#fff",
          }}
        >
          <iframe src={src} title={label} style={{ width: "100%", height: "100%", border: 0 }} />
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={count > 0 ? `${label}, ${count} new` : label}
        title={label}
        style={{
          position: "fixed",
          right: 16,
          bottom,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: open ? "#333" : "#000",
          color: "#fff",
          border: 0,
          cursor: "pointer",
          zIndex: 1001,
          fontSize: 24,
          boxShadow: "0 4px 12px rgba(0,0,0,.3)",
        }}
      >
        {icon}
        {count > 0 && (
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
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
    </>
  );
};

const SellerBubbles = () => {
  // Only one window open at a time
  const [open, setOpen] = useState<"chat" | "orders" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <FrameBubble
        icon="📦"
        label="Orders"
        src="/seller/orders?embed=1"
        countPath="/api/trpc/orders.attentionCount"
        closeMessage="digimall-orders-close"
        bottom={84}
        open={open === "orders"}
        onToggle={() => setOpen(open === "orders" ? null : "orders")}
        onClose={close}
      />
      <FrameBubble
        icon="💬"
        label="Chats"
        src="/chat?embed=1"
        countPath="/api/trpc/chat.unreadCount"
        closeMessage="digimall-chat-close"
        bottom={16}
        open={open === "chat"}
        onToggle={() => setOpen(open === "chat" ? null : "chat")}
        onClose={close}
      />
    </>
  );
};

// Payload admin "provider": wraps every admin page; shows the bubbles only for sellers with a store
export const SellerChatHead = ({ children }: { children?: React.ReactNode }) => {
  const { user } = useAuth();
  const isSellerWithStore =
    (user as { role?: string } | null)?.role === "seller" &&
    ((user as { tenants?: unknown[] } | null)?.tenants?.length ?? 0) > 0;
  return (
    <>
      {children}
      {isSellerWithStore && <SellerBubbles />}
    </>
  );
};

export default SellerChatHead;
