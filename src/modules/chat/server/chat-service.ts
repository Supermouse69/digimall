import { TRPCError } from "@trpc/server";
import type { Payload, PayloadRequest } from "payload";

import { getUserTenantIds, isBuyer, isSeller, PUBLIC_STORE_STATUSES } from "@/lib/access";
import { buyerDisplayName } from "@/lib/chat-name";
import { relationId } from "@/lib/private-files";
import type { Conversation, Media, Message, PrivateMedia, Tenant, User } from "@/payload-types";
import { getSettings } from "@/modules/settings/server/settings";

// Store chat (CLAUDE.md §11.3): one thread per buyer + store. All access checks live here;
// the conversations/messages collections themselves are closed to the API.
// Every function takes { payload, req? } so tests can run inside a cancelled transaction.

export type ChatCtx = { payload: Payload; req?: PayloadRequest };
export type ChatActor =
  | { side: "buyer"; userId: string }
  | { side: "store"; userId: string; tenantIds: string[] };

// Buyers chat as themselves; sellers chat as their store. Nobody else uses store chat.
export const chatActorFor = (user: User | null | undefined): ChatActor | null => {
  if (!user) return null;
  if (isBuyer(user)) return { side: "buyer", userId: user.id };
  if (isSeller(user)) {
    const tenantIds = getUserTenantIds(user);
    return tenantIds.length > 0 ? { side: "store", userId: user.id, tenantIds } : null;
  }
  return null;
};

const MAX_TEXT = 2000;
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Chat not found." });
const threadKeyFor = (buyerId: string, tenantId: string) => `store:${buyerId}:${tenantId}`;
const isPublicStatus = (status: unknown) => (PUBLIC_STORE_STATUSES as readonly unknown[]).includes(status);

export const isCleared = (conversation: Pick<Conversation, "deleteAfter" | "underReport">, now = Date.now()) =>
  Boolean(conversation.deleteAfter && Date.parse(conversation.deleteAfter) < now && !conversation.underReport);

const isUnreadFor = (actor: ChatActor, conversation: Conversation) => {
  if (!conversation.lastMessageAt || isCleared(conversation)) return false;
  const otherSide = actor.side === "buyer" ? "store" : "buyer";
  if (conversation.lastSenderSide !== otherSide) return false;
  const readAt = actor.side === "buyer" ? conversation.buyerLastReadAt : conversation.storeLastReadAt;
  return !readAt || Date.parse(conversation.lastMessageAt) > Date.parse(readAt);
};

const mediaUrl = (value: unknown): string | null =>
  value && typeof value === "object" && "url" in value ? ((value as Media | PrivateMedia).url ?? null) : null;

// Loads a chat only if this person is part of it (otherwise it "doesn't exist")
export const loadConversationFor = async ({ payload, req }: ChatCtx, actor: ChatActor, id: string) => {
  const conversation = (await payload
    .findByID({ collection: "conversations", id, depth: 0, overrideAccess: true, req })
    .catch(() => null)) as Conversation | null;
  if (!conversation) throw notFound();
  const member =
    actor.side === "buyer"
      ? relationId(conversation.buyer) === actor.userId
      : actor.tenantIds.includes(relationId(conversation.tenant) ?? "");
  if (!member) throw notFound();
  return conversation;
};

const findStore = async ({ payload, req }: ChatCtx, where: { slug: string } | { id: string }) => {
  const { docs } = await payload.find({
    collection: "tenants",
    where: "slug" in where ? { slug: { equals: where.slug } } : { id: { equals: where.id } },
    depth: 1,
    limit: 1,
    overrideAccess: true,
    req,
  });
  return (docs[0] as Tenant | undefined) ?? null;
};

// ---------- reading ----------

export type ThreadSummary = {
  id: string;
  title: string;
  avatarUrl: string | null;
  storeSlug: string | null;
  preview: string;
  lastMessageAt: string | null;
  unread: boolean;
};

export const listThreads = async (ctx: ChatCtx, actor: ChatActor): Promise<ThreadSummary[]> => {
  const { docs } = await ctx.payload.find({
    collection: "conversations",
    where: {
      and: [
        { type: { equals: "store" } },
        actor.side === "buyer" ? { buyer: { equals: actor.userId } } : { tenant: { in: actor.tenantIds } },
        { lastMessageAt: { exists: true } },
      ],
    },
    sort: "-lastMessageAt",
    depth: 1,
    limit: 100,
    overrideAccess: true,
    req: ctx.req,
  });
  return (docs as Conversation[]).map((conversation) => {
    const store = typeof conversation.tenant === "object" ? (conversation.tenant as Tenant | null) : null;
    const buyer = typeof conversation.buyer === "object" ? (conversation.buyer as User) : null;
    const cleared = isCleared(conversation);
    return {
      id: conversation.id,
      // Buyers see the store; stores see only the buyer's username or first name
      title: actor.side === "buyer" ? (store?.name ?? "Store") : buyerDisplayName(buyer ?? {}),
      avatarUrl: actor.side === "buyer" ? mediaUrl(store?.logo) : null,
      storeSlug: store?.slug ?? null,
      preview: cleared ? "Old messages were cleared" : (conversation.lastMessagePreview ?? ""),
      lastMessageAt: conversation.lastMessageAt ?? null,
      unread: isUnreadFor(actor, conversation),
    };
  });
};

export const unreadCount = async (ctx: ChatCtx, actor: ChatActor) =>
  (await listThreads(ctx, actor)).filter((thread) => thread.unread).length;

export type ChatMessage = {
  id: string;
  side: "buyer" | "store" | "system";
  mine: boolean;
  kind: "text" | "image" | "product_ref" | "system";
  text: string | null;
  imageUrl: string | null;
  product: { id: string; name: string; price: number; storeSlug: string } | null;
  createdAt: string;
};

const toChatMessage = (actor: ChatActor, message: Message): ChatMessage => ({
  id: message.id,
  side: message.side,
  mine: message.side === actor.side,
  kind: message.kind,
  text: message.text ?? null,
  imageUrl: mediaUrl(message.image),
  product:
    message.kind === "product_ref" && message.productSnapshot?.name
      ? {
          id: relationId(message.product) ?? "",
          name: message.productSnapshot.name,
          price: message.productSnapshot.price ?? 0,
          storeSlug: message.productSnapshot.storeSlug ?? "",
        }
      : null,
  createdAt: message.createdAt,
});

export const getThread = async (ctx: ChatCtx, actor: ChatActor, conversationId: string, after?: string) => {
  const conversation = await loadConversationFor(ctx, actor, conversationId);
  const store = await findStore(ctx, { id: relationId(conversation.tenant) ?? "" });
  const buyer = (await ctx.payload
    .findByID({ collection: "users", id: relationId(conversation.buyer) ?? "", depth: 0, overrideAccess: true, req: ctx.req })
    .catch(() => null)) as User | null;
  const header = {
    id: conversation.id,
    mySide: actor.side,
    title: actor.side === "buyer" ? (store?.name ?? "Store") : buyerDisplayName(buyer ?? {}),
    storeSlug: store?.slug ?? null,
    avatarUrl: actor.side === "buyer" ? mediaUrl(store?.logo) : null,
    // Buyers can only write to stores that are open on DigiMall
    canSend: actor.side === "store" || Boolean(store && isPublicStatus(store.status)),
  };
  if (isCleared(conversation)) return { ...header, cleared: true, messages: [] as ChatMessage[] };

  const { docs } = await ctx.payload.find({
    collection: "messages",
    where: {
      and: [{ conversation: { equals: conversation.id } }, ...(after ? [{ createdAt: { greater_than: after } }] : [])],
    },
    sort: "-createdAt",
    depth: 1,
    limit: 100,
    overrideAccess: true,
    req: ctx.req,
  });
  return { ...header, cleared: false, messages: (docs as Message[]).reverse().map((m) => toChatMessage(actor, m)) };
};

// The buyer opened "Chat with store": the existing thread, if there is one (it's created on the first message)
export const findStoreThread = async (ctx: ChatCtx, actor: ChatActor, storeSlug: string) => {
  if (actor.side !== "buyer") throw new TRPCError({ code: "FORBIDDEN", message: "Use a buyer account to chat with stores." });
  const store = await findStore(ctx, { slug: storeSlug });
  if (!store || !isPublicStatus(store.status)) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
  const { docs } = await ctx.payload.find({
    collection: "conversations",
    where: { threadKey: { equals: threadKeyFor(actor.userId, store.id) } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req: ctx.req,
  });
  return { conversationId: (docs[0]?.id as string | undefined) ?? null, store: { name: store.name, slug: store.slug, logoUrl: mediaUrl(store.logo) } };
};

// ---------- writing ----------

export const markRead = async (ctx: ChatCtx, actor: ChatActor, conversationId: string) => {
  const conversation = await loadConversationFor(ctx, actor, conversationId);
  await ctx.payload.update({
    collection: "conversations",
    id: conversation.id,
    data: actor.side === "buyer" ? { buyerLastReadAt: new Date().toISOString() } : { storeLastReadAt: new Date().toISOString() },
    overrideAccess: true,
    req: ctx.req,
  });
};

// Deletes a chat's messages and their photos (files too)
const deleteMessagesOf = async ({ payload, req }: ChatCtx, conversationId: string) => {
  const { docs } = await payload.find({
    collection: "messages",
    where: { conversation: { equals: conversationId } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  });
  const imageIds = (docs as Message[]).map((m) => relationId(m.image)).filter((id): id is string => Boolean(id));
  if (imageIds.length > 0) {
    await payload.delete({ collection: "private-media", where: { id: { in: imageIds } }, overrideAccess: true, req });
  }
  await payload.delete({ collection: "messages", where: { conversation: { equals: conversationId } }, overrideAccess: true, req });
  return docs.length;
};

export type SendInput = {
  conversationId?: string;
  storeSlug?: string; // buyer's first message to a store
  text?: string;
  imageId?: string;
  productId?: string;
};

export const sendMessage = async (ctx: ChatCtx, actor: ChatActor, input: SendInput) => {
  const { payload, req } = ctx;
  const text = input.text?.trim().slice(0, MAX_TEXT) || "";
  if (!text && !input.imageId && !input.productId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Write a message first." });
  }

  // 1. Which chat
  let conversation: Conversation;
  if (input.conversationId) {
    conversation = await loadConversationFor(ctx, actor, input.conversationId);
  } else if (input.storeSlug && actor.side === "buyer") {
    const store = await findStore(ctx, { slug: input.storeSlug });
    if (!store || !isPublicStatus(store.status)) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
    const threadKey = threadKeyFor(actor.userId, store.id);
    const existing = (await payload.find({ collection: "conversations", where: { threadKey: { equals: threadKey } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0];
    conversation = (existing ??
      (await payload
        .create({ collection: "conversations", data: { threadKey, type: "store", buyer: actor.userId, tenant: store.id }, overrideAccess: true, req })
        .catch(async () =>
          // Two first messages at the same moment: the unique threadKey lets only one create it
          (await payload.find({ collection: "conversations", where: { threadKey: { equals: threadKey } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0],
        ))) as Conversation;
    if (!conversation) throw notFound();
  } else {
    throw notFound();
  }

  const tenantId = relationId(conversation.tenant) ?? "";
  const store = await findStore(ctx, { id: tenantId });
  if (actor.side === "buyer" && !(store && isPublicStatus(store.status))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This store isn't available on DigiMall right now." });
  }

  // 2. Expired chat: clear the old messages first, then start fresh (lazy cleanup)
  if (isCleared(conversation)) await deleteMessagesOf(ctx, conversation.id);

  // 3. Check attachments before saving anything
  let product: { id: string; name: string; price: number } | null = null;
  if (input.productId) {
    const found = (await payload.findByID({ collection: "products", id: input.productId, depth: 0, overrideAccess: true, req }).catch(() => null)) as
      | { id: string; name: string; price: number; tenant: unknown; isHidden?: boolean | null }
      | null;
    if (!found || found.isHidden || relationId(found.tenant) !== tenantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That product isn't from this store." });
    }
    product = found;
  }
  if (input.imageId) {
    const file = (await payload.findByID({ collection: "private-media", id: input.imageId, depth: 0, overrideAccess: true, req }).catch(() => null)) as PrivateMedia | null;
    const fileConversation = relationId((file as { conversation?: unknown } | null)?.conversation);
    if (!file || relationId(file.owner) !== actor.userId || file.purpose !== "chat-image" || (fileConversation && fileConversation !== conversation.id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can only send photos you uploaded." });
    }
    // From now on the other person in this chat may see the photo
    await payload.update({ collection: "private-media", id: file.id, data: { conversation: conversation.id } as never, overrideAccess: true, req });
  }

  // 4. Save the message(s)
  const base = { conversation: conversation.id, side: actor.side, sender: actor.userId } as const;
  if (product) {
    await payload.create({
      collection: "messages",
      data: { ...base, kind: "product_ref", product: product.id, productSnapshot: { name: product.name, price: product.price, storeSlug: store?.slug ?? "" } },
      overrideAccess: true,
      req,
    });
  }
  if (input.imageId) {
    await payload.create({ collection: "messages", data: { ...base, kind: "image", image: input.imageId, text: text || undefined }, overrideAccess: true, req });
  } else if (text) {
    await payload.create({ collection: "messages", data: { ...base, kind: "text", text }, overrideAccess: true, req });
  }

  // 5. Thread summary, unread markers, and the new delete date
  const now = new Date();
  const { chatRetentionDays } = await getSettings(payload);
  const preview = input.imageId ? "📷 Photo" : text ? text.slice(0, 100) : `Asked about: ${product?.name ?? "a product"}`;
  await payload.update({
    collection: "conversations",
    id: conversation.id,
    data: {
      lastMessageAt: now.toISOString(),
      lastMessagePreview: preview,
      lastSenderSide: actor.side,
      ...(actor.side === "buyer" ? { buyerLastReadAt: now.toISOString() } : { storeLastReadAt: now.toISOString() }),
      deleteAfter: new Date(now.getTime() + chatRetentionDays * 86_400_000).toISOString(),
    },
    overrideAccess: true,
    req,
  });
  return { conversationId: conversation.id };
};

// ---------- reports + retention ----------

// A reported chat is kept (not auto-deleted) and becomes readable for the super-admin (logged)
export const flagConversationForReport = async (ctx: ChatCtx, actor: ChatActor, conversationId: string) => {
  const conversation = await loadConversationFor(ctx, actor, conversationId);
  await ctx.payload.update({ collection: "conversations", id: conversation.id, data: { underReport: true }, overrideAccess: true, req: ctx.req });
  return conversation;
};

// Daily job (and `bun run chat:cleanup`): deletes chats past their delete date, unless under report
export const purgeExpiredChats = async (ctx: ChatCtx, now = new Date()) => {
  const { docs } = await ctx.payload.find({
    collection: "conversations",
    where: { and: [{ deleteAfter: { less_than: now.toISOString() } }, { underReport: { not_equals: true } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req: ctx.req,
  });
  let messages = 0;
  for (const conversation of docs) {
    messages += await deleteMessagesOf(ctx, conversation.id);
    await ctx.payload.delete({ collection: "conversations", id: conversation.id, overrideAccess: true, req: ctx.req });
  }
  return { conversations: docs.length, messages };
};
