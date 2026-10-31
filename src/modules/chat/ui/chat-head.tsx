"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";

import { ChatPanel } from "./chat-panel";
import { useChatWidget } from "./chat-widget-store";

// The floating chat bubble ("chat head", like other shopping apps) on every buyer-site page.
// Only for logged-in buyers and sellers. Phones: the chat opens full screen.
const HIDDEN_ON = ["/chat", "/login", "/sign-up", "/forgot-password", "/reset-password", "/verify-email", "/consent", "/admin-entry", "/rider"];

export const ChatHead = () => {
  const trpc = useTRPC();
  const pathname = usePathname();
  const { isOpen, target, open, close } = useChatWidget();
  const session = useQuery(trpc.auth.session.queryOptions());
  const role = session.data?.user?.role;
  const canChat = role === "buyer" || (role === "seller" && Boolean(session.data?.user?.store));
  const unread = useQuery({
    ...trpc.chat.unreadCount.queryOptions(),
    enabled: canChat,
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 20000 : false),
  });

  if (!canChat || HIDDEN_ON.some((path) => pathname.startsWith(path))) return null;
  const count = unread.data?.count ?? 0;

  return (
    <>
      {isOpen && (
        <div className="fixed z-50 inset-0 sm:inset-auto sm:bottom-24 sm:right-4 sm:w-[380px] sm:h-[560px] sm:rounded-lg sm:border sm:shadow-xl overflow-hidden bg-white">
          <ChatPanel key={target ? `${target.storeSlug}:${target.productId ?? ""}` : "list"} target={target} onClose={close} />
        </div>
      )}
      <button
        type="button"
        onClick={() => (isOpen ? close() : open())}
        className="fixed z-40 bottom-4 right-4 size-14 rounded-full bg-black text-white shadow-lg flex items-center justify-center"
        aria-label={count > 0 ? `Chats, ${count} new` : "Chats"}
      >
        <MessageCircleIcon className="size-6" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-pink-500 text-xs font-semibold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
    </>
  );
};
