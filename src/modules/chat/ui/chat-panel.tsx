"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ImageIcon, SendIcon, StoreIcon, UserIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { cn, formatCurrency, generateTenantURL } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ReportButton } from "@/modules/reports/ui/report-button";

import { OrderCard } from "@/modules/orders/ui/order-card";

import type { ChatTarget } from "./chat-widget-store";

// Polling = "realtime" for the beta (CLAUDE.md §11.3): every 4 s while a chat is open and the
// tab is visible, every 15 s for the chat list. Nothing runs while the tab is hidden.
const THREAD_POLL_MS = 4000;
const LIST_POLL_MS = 15000;
const whenVisible = (ms: number) => () => (typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false);

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Chat photos go to PRIVATE storage; only this chat's buyer + store (and the super-admin) can open them
const uploadChatPhoto = async (file: File): Promise<string> => {
  const body = new FormData();
  body.append("file", file);
  body.append("_payload", JSON.stringify({ purpose: "chat-image" }));
  const res = await fetch("/api/private-media", { method: "POST", body, credentials: "include" });
  const json = (await res.json().catch(() => null)) as { doc?: { id: string }; errors?: { message?: string }[] } | null;
  if (!res.ok || !json?.doc?.id) throw new Error(json?.errors?.[0]?.message ?? "Photo upload failed. Please try again.");
  return json.doc.id;
};

type View = { name: "list" } | { name: "thread"; conversationId: string | null; storeSlug?: string; productId?: string };

interface Props {
  // "Chat with store" opens straight into that store's thread (with the product card ready to send).
  // Give the panel a new `key` when the target changes so it starts fresh.
  target?: ChatTarget;
  onClose?: () => void;
  className?: string;
}

export const ChatPanel = ({ target, onClose, className }: Props) => {
  const [view, setView] = useState<View>(() =>
    target ? { name: "thread", conversationId: null, storeSlug: target.storeSlug, productId: target.productId } : { name: "list" },
  );

  return (
    <div className={cn("flex flex-col bg-white h-full min-h-0", className)}>
      {view.name === "list" ? (
        <ThreadList onOpen={(conversationId) => setView({ name: "thread", conversationId })} onClose={onClose} />
      ) : (
        <ThreadView
          key={view.conversationId ?? view.storeSlug}
          initialConversationId={view.conversationId}
          storeSlug={view.storeSlug}
          productId={view.productId}
          onBack={() => setView({ name: "list" })}
          onClose={onClose}
        />
      )}
    </div>
  );
};

const PanelHeader = ({ children, onBack, onClose }: { children: React.ReactNode; onBack?: () => void; onClose?: () => void }) => (
  <div className="flex items-center gap-2 border-b px-3 h-14 shrink-0">
    {onBack && (
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to chats">
        <ArrowLeftIcon />
      </Button>
    )}
    <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
    {onClose && (
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
        <XIcon />
      </Button>
    )}
  </div>
);

const Avatar = ({ url, side }: { url: string | null; side: "buyer" | "store" }) =>
  url ? (
    <Image src={url} alt="" width={36} height={36} className="size-9 rounded-full border object-cover shrink-0" />
  ) : (
    <div className="size-9 rounded-full border flex items-center justify-center shrink-0 bg-neutral-50">
      {side === "store" ? <StoreIcon className="size-4" /> : <UserIcon className="size-4" />}
    </div>
  );

const ThreadList = ({ onOpen, onClose }: { onOpen: (id: string) => void; onClose?: () => void }) => {
  const trpc = useTRPC();
  const me = useQuery(trpc.chat.me.queryOptions());
  const threads = useQuery({ ...trpc.chat.threads.queryOptions(), refetchInterval: whenVisible(LIST_POLL_MS) });
  const otherSide = me.data?.side === "store" ? "buyer" : "store";

  return (
    <>
      <PanelHeader onClose={onClose}>
        <h2 className="font-medium text-lg">Chats</h2>
      </PanelHeader>
      <div className="flex-1 overflow-y-auto">
        {threads.isLoading && <p className="p-4 text-sm text-neutral-600">Loading…</p>}
        {threads.data?.length === 0 && (
          <p className="p-4 text-sm text-neutral-600">
            {me.data?.side === "store"
              ? "No chats yet. Buyers' questions will show up here."
              : "No chats yet. Tap \"Chat with store\" on a store or product page to ask something."}
          </p>
        )}
        <ul>
          {threads.data?.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                className="w-full flex items-center gap-3 px-3 py-3 border-b text-left hover:bg-neutral-50"
              >
                <Avatar url={thread.avatarUrl} side={otherSide} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate", thread.unread && "font-semibold")}>{thread.title}</span>
                    {thread.lastMessageAt && <span className="text-xs text-neutral-500 shrink-0">{timeLabel(thread.lastMessageAt)}</span>}
                  </div>
                  <p className={cn("text-sm truncate", thread.unread ? "text-black font-medium" : "text-neutral-600")}>{thread.preview}</p>
                </div>
                {thread.unread && <span className="size-2.5 rounded-full bg-pink-500 shrink-0" aria-label="New message" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

interface ThreadProps {
  initialConversationId: string | null;
  storeSlug?: string;
  productId?: string;
  onBack: () => void;
  onClose?: () => void;
}

const ThreadView = ({ initialConversationId, storeSlug, productId, onBack, onClose }: ThreadProps) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [attachProduct, setAttachProduct] = useState(Boolean(productId));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // New chat from a store page: is there already a thread with this store?
  const existing = useQuery({
    ...trpc.chat.findStoreThread.queryOptions({ storeSlug: storeSlug ?? "" }),
    enabled: !initialConversationId && Boolean(storeSlug),
  });
  // The chat being shown: opened from the list, found for this store, or just created by the first message
  const conversationId = initialConversationId ?? existing.data?.conversationId ?? createdId;

  const thread = useQuery({
    ...trpc.chat.thread.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: Boolean(conversationId),
    refetchInterval: whenVisible(THREAD_POLL_MS),
  });
  const product = useQuery({
    ...trpc.products.getOne.queryOptions({ id: productId ?? "" }),
    enabled: Boolean(productId) && attachProduct,
  });

  const markRead = useMutation(trpc.chat.markRead.mutationOptions({
    onSuccess: () => {
      void queryClient.invalidateQueries(trpc.chat.unreadCount.queryFilter());
      void queryClient.invalidateQueries(trpc.chat.threads.queryFilter());
    },
  }));
  const lastMessageId = thread.data?.messages.at(-1)?.id;
  useEffect(() => {
    if (conversationId && lastMessageId) markRead.mutate({ conversationId });
    bottomRef.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new message arrives
  }, [conversationId, lastMessageId]);

  const send = useMutation(trpc.chat.send.mutationOptions({
    onSuccess: async (result) => {
      setText("");
      setAttachProduct(false);
      if (!conversationId) setCreatedId(result.conversationId);
      await queryClient.invalidateQueries(trpc.chat.thread.queryFilter());
      void queryClient.invalidateQueries(trpc.chat.threads.queryFilter());
    },
    onError: (error) =>
      toast.error(error.data?.code === "INTERNAL_SERVER_ERROR" ? "Couldn't send. Please try again." : error.message),
  }));

  const target = conversationId ? { conversationId } : { storeSlug };
  const submit = (imageId?: string) => {
    const message = text.trim();
    if (!message && !imageId && !attachProduct) return;
    send.mutate({ ...target, text: message || undefined, imageId, productId: attachProduct ? productId : undefined });
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Please use a JPG, PNG, or WebP photo.");
    if (file.size > MAX_PHOTO_BYTES) return toast.error("That photo is over 5 MB.");
    setUploading(true);
    try {
      submit(await uploadChatPhoto(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const title = thread.data?.title ?? existing.data?.store.name ?? "Chat";
  const avatarUrl = thread.data?.avatarUrl ?? existing.data?.store.logoUrl ?? null;
  const slug = thread.data?.storeSlug ?? existing.data?.store.slug ?? storeSlug;
  const canSend = thread.data ? thread.data.canSend : !existing.isError;
  const isStoreSide = thread.data?.mySide === "store";

  return (
    <>
      <PanelHeader onBack={onBack} onClose={onClose}>
        <Avatar url={avatarUrl} side={isStoreSide ? "buyer" : "store"} />
        <div className="min-w-0">
          <p className="font-medium truncate">{title}</p>
          {slug && !isStoreSide && (
            <Link href={generateTenantURL(slug)} className="text-xs underline text-neutral-600">
              View store
            </Link>
          )}
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 bg-neutral-50">
        {existing.isError && <p className="text-sm text-red-600">{existing.error.message}</p>}
        {thread.data?.cleared && (
          <p className="text-center text-xs text-neutral-500">Older messages were cleared after the chat was inactive.</p>
        )}
        {!conversationId && !existing.isLoading && !existing.isError && (
          <p className="text-center text-sm text-neutral-600 py-6">Ask the store anything, like whether an item is available.</p>
        )}
        {thread.data?.messages.map((message) =>
          message.kind === "order_card" && message.storeOrderId ? (
            // Live order card with the right buttons for the buyer or the store (Phase 5)
            <div key={message.id} className="self-stretch">
              <OrderCard storeOrderId={message.storeOrderId} compact />
            </div>
          ) : message.side === "system" ? (
            <p key={message.id} className="text-center text-xs text-neutral-500">{message.text}</p>
          ) : (
            <div key={message.id} className={cn("max-w-[80%] flex flex-col gap-1", message.mine ? "self-end items-end" : "self-start items-start")}>
              {message.product && (
                <Link
                  href={`${generateTenantURL(message.product.storeSlug)}/products/${message.product.id}`}
                  className="rounded-md border bg-white p-2 text-sm hover:underline"
                >
                  <span className="block text-xs text-neutral-500">Product</span>
                  <span className="font-medium">{message.product.name}</span> · {formatCurrency(message.product.price)}
                </Link>
              )}
              {message.imageUrl && (
                // Private file served through our access check; next/image can't fetch it with the login cookie
                // eslint-disable-next-line @next/next/no-img-element
                <img src={message.imageUrl} alt="Photo sent in chat" className="rounded-md border max-h-60 bg-white" loading="lazy" />
              )}
              {message.text && (
                <p className={cn("rounded-2xl px-3 py-2 whitespace-pre-wrap break-words", message.mine ? "bg-black text-white" : "bg-white border")}>
                  {message.text}
                </p>
              )}
              <span className="text-[11px] text-neutral-500">{timeLabel(message.createdAt)}</span>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {conversationId && (
        <div className="px-3 pt-2 bg-white">
          <ReportButton targetType="conversation" targetId={conversationId} />
        </div>
      )}

      {canSend ? (
        <form
          className="border-t p-2 flex flex-col gap-2 bg-white shrink-0"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {attachProduct && product.data && (
            <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <span className="truncate">
                Asking about: <strong>{product.data.name}</strong> · {formatCurrency(product.data.price)}
              </span>
              <Button type="button" variant="ghost" size="icon" onClick={() => setAttachProduct(false)} aria-label="Remove product">
                <XIcon />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onPhoto(event.target.files?.[0])} />
            <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={uploading || send.isPending} aria-label="Send a photo">
              <ImageIcon />
            </Button>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Write a message"
              className="flex-1 resize-none rounded-md border px-3 py-2 text-base max-h-32"
              aria-label="Message"
            />
            <Button type="submit" size="icon" disabled={send.isPending || uploading || (!text.trim() && !attachProduct)} className="bg-black text-white" aria-label="Send">
              <SendIcon />
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t p-3 text-sm text-neutral-600 bg-white">This store isn&apos;t available on DigiMall right now.</p>
      )}
    </>
  );
};
