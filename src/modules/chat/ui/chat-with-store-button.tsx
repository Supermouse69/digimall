"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useChatWidget } from "./chat-widget-store";

// "Chat with store" on store and product pages: opens the chat head on that store's thread
// (with the product card ready to send). Logged-out visitors log in first.
export const ChatWithStoreButton = ({ storeSlug, productId, className }: { storeSlug: string; productId?: string; className?: string }) => {
  const trpc = useTRPC();
  const pathname = usePathname();
  const open = useChatWidget((state) => state.open);
  const session = useQuery(trpc.auth.session.queryOptions());
  const role = session.data?.user?.role;

  if (!session.data?.user) {
    return (
      <Button asChild variant="elevated" className={cn("bg-white", className)}>
        <Link href={`/login?next=${encodeURIComponent(pathname)}`}>
          <MessageCircleIcon /> Chat with store
        </Link>
      </Button>
    );
  }
  if (role !== "buyer") {
    // One role per account (CLAUDE.md §7): sellers and riders use a separate buyer account to shop
    return (
      <Button variant="elevated" disabled className={cn("bg-white", className)} title="Use a buyer account to chat with stores">
        <MessageCircleIcon /> Chat with store (buyers only)
      </Button>
    );
  }
  return (
    <Button variant="elevated" className={cn("bg-white", className)} onClick={() => open({ storeSlug, productId })}>
      <MessageCircleIcon /> Chat with store
    </Button>
  );
};
