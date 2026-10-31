"use client";

import { useRouter } from "next/navigation";

import { ChatPanel } from "@/modules/chat/ui/chat-panel";

export const FullPageChat = ({ embedded }: { embedded: boolean }) => {
  const router = useRouter();
  // Inside the admin panel's chat head: closing tells the admin page to hide the frame
  const onClose = embedded
    ? () => window.parent.postMessage("digimall-chat-close", window.location.origin)
    : () => router.push("/");
  return (
    <main className={embedded ? "h-dvh" : "h-dvh max-w-2xl mx-auto border-x"}>
      <ChatPanel onClose={onClose} />
    </main>
  );
};
