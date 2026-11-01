import { TRPCError } from "@trpc/server";
import type { Payload, PayloadRequest, Where } from "payload";

import { getUserTenantIds, isBuyer, isRider, isSeller, PUBLIC_STORE_STATUSES } from "@/lib/access";
import { buyerDisplayName } from "@/lib/chat-name";
import { relationId } from "@/lib/private-files";
import type { Conversation, Media, Message, Order, PrivateMedia, Tenant, User } from "@/payload-types";
import { getSettings } from "@/modules/settings/server/settings";
import { pushToUsers, sellerIdsOfStore } from "@/modules/notifications/server/push";

// Chats (CLAUDE.md §11.3). Two kinds:
// - store chat: one thread per buyer + store
// - trip chat: buyer + the assigned rider of one order (Phase 6); read-only after the trip ends
// All access checks live here; the conversations/messages collections are closed to the API.
// Every function takes { payload, req? } so tests can run inside a cancelled transaction.

export type ChatCtx = { payload: Payload; req?: PayloadRequest };
export type ChatSide = "buyer" | "store" | "rider";
export type ChatActor =
  | { side: "buyer"; userId: string }
  | { side: "store"; userId: string; tenantIds: string[] }
  | { side: "rider"; userId: string };

// Buyers chat as themselves, sellers as their store, riders in their trip chats only
export const chatActorFor = (user: User | null | undefined): ChatActor | null => {
  if (!user) return null;
  if (isBuyer(user)) return { side: "buyer", userId: user.id };
  if (isSeller(user)) {
    const tenantIds = getUserTenantIds(user);
    return tenantIds.length > 0 ? { side: "store", userId: user.id, tenantIds } : null;
  }
  if (isRider(user)) return { side: "rider", userId: user.id };
  return null;
};

const MAX_TEXT = 2000;
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Chat not found." });
const threadKeyFor = (buyerId: string, tenantId: string) => `store:${buyerId}:${tenantId}`;
export const tripThreadKey = (orderId: string) => `trip:${orderId}`;
const isPublicStatus = (status: unknown) => (PUBLIC_STORE_STATUSES as readonly unknown[]).includes(status);
const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || "Rider";

const READ_FIELD = { buyer: "buyerLastReadAt", store: "storeLastReadAt", rider: "riderLastReadAt" } as const;

export const isCleared = (conversation: Pick<Conversation, "deleteAfter" | "underReport">, now = Date.now()) =>
  Boolean(conversation.deleteAfter && Date.parse(conversation.deleteAfter) < now && !conversation.underReport);

// New for me = someone else (or the system, for me) wrote after I last read
const isUnreadFor = (actor: ChatActor, conversation: Conversation) => {
  if (!conversation.lastMessageAt || isCleared(conversation)) return false;
  if (conversation.lastSenderSide === actor.side) return false;
  const readAt = conversation[READ_FIELD[actor.side]];
  return !readAt || Date.parse(conversation.lastMessageAt) > Date.parse(readAt);
};

const mediaUrl = (value: unknown): string | null =>
  value && typeof value === "object" && "url" in value ? ((value as Media | PrivateMedia).url ?? null) : null;

const isMember = (actor: ChatActor, conversation: Conversation) => {
  if (actor.side === "buyer") return relationId(conversation.buyer) === actor.userId;
  if (actor.side === "rider") return conversation.type === "trip" && relationId(conversation.rider) === actor.userId;
  return conversation.type === "store" && actor.tenantIds.includes(relationId(conversation.tenant) ?? "");
};

// Loads a chat only if this person is part of it (otherwise it "doesn't exist")
export const loadConversationFor = async ({ payload, req }: ChatCtx, actor: ChatActor, id: string) => {
  const conversation = (await payload
    .findByID({ collection: "conversations", id, depth: 0, overrideAccess: true, req })
    .catch(() => null)) as Conversation | null;
  if (!conversation || !isMember(actor, conversation)) throw notFound();
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

const findUser = async ({ payload, req }: ChatCtx, id: string | null) =>
  id ? ((await payload.findByID({ collection: "users", id, depth: 0, overrideAccess: true, req }).catch(() => null)) as User | null) : null;

// ---------- push ----------

// Who to tell, and where their phone should open
const notifySide = async (ctx: ChatCtx, conversation: Conversation, side: ChatSide, text: string) => {
  if (side === "store") {
    const tenantId = relationId(conversation.tenant);
    if (!tenantId) return;
    await pushToUsers(ctx, await sellerIdsOfStore(ctx, tenantId), { title: "DigiMall store chat", body: text, url: "/seller/orders", tag: conversation.id });
    return;
  }
  if (side === "rider") {
    await pushToUsers(ctx, [relationId(conversation.rider) ?? ""], { title: "DigiMall trip", body: text, url: "/rider", tag: conversation.id });
    return;
  }
  const orderId = relationId(conversation.order);
  const order = orderId
    ? ((await ctx.payload.findByID({ collection: "orders", id: orderId, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as Order | null)
    : null;
  await pushToUsers(ctx, [relationId(conversation.buyer) ?? ""], {
    title: conversation.type === "trip" ? "Your rider" : "DigiMall",
    body: text,
    url: order ? `/orders/${order.code}` : "/chat",
    tag: conversation.id,
  });
};

const otherSides = (conversation: Pick<Conversation, "type">, me: ChatSide): ChatSide[] =>
  (conversation.type === "trip" ? (["buyer", "rider"] as const) : (["buyer", "store"] as const)).filter((side) => side !== me);

// ---------- reading ----------

export type ThreadSummary = {
  id: string;
  type: "store" | "trip";
  title: string;
  avatarUrl: string | null;
  storeSlug: string | null;
  preview: string;
  lastMessageAt: string | null;
  unread: boolean;
};

const threadTitle = async (ctx: ChatCtx, actor: ChatActor, conversation: Conversation) => {
  if (conversation.type === "trip") {
    const orderId = relationId(conversation.order);
    const order = orderId
      ? ((await ctx.payload.findByID({ collection: "orders", id: orderId, depth: 0, overrideAccess: true, req: ctx.req }).catch(() => null)) as Order | null)
      : null;
    const code = order?.code ? ` · ${order.code}` : "";
    if (actor.side === "rider") return `${buyerDisplayName((await findUser(ctx, relationId(conversation.buyer))) ?? {})}${code}`;
    return `Rider ${firstName((await findUser(ctx, relationId(conversation.rider)))?.name)}${code}`;
  }
  const store = typeof conversation.tenant === "object" ? (conversation.tenant as Tenant | null) : await findStore(ctx, { id: relationId(conversation.tenant) ?? "" });
  // Buyers see the store; stores see only the buyer's username or first name
  if (actor.side === "buyer") return store?.name ?? "Store";
  const buyer = typeof conversation.buyer === "object" ? (conversation.buyer as User) : await findUser(ctx, relationId(conversation.buyer));
  return buyerDisplayName(buyer ?? {});
};

export const listThreads = async (ctx: ChatCtx, actor: ChatActor): Promise<ThreadSummary[]> => {
  const mine: Where =
    actor.side === "buyer"
      ? { buyer: { equals: actor.userId } }
      : actor.side === "rider"
        ? { and: [{ rider: { equals: actor.userId } }, { type: { equals: "trip" } }] }
        : { and: [{ tenant: { in: actor.tenantIds } }, { type: { equals: "store" } }] };
  const { docs } = await ctx.payload.find({
    collection: "conversations",
    where: { and: [mine, { lastMessageAt: { exists: true } }] },
    sort: "-lastMessageAt",
    depth: 1,
    limit: 100,
    overrideAccess: true,
    req: ctx.req,
  });
  const threads: ThreadSummary[] = [];
  for (const conversation of docs as Conversation[]) {
    const store = typeof conversation.tenant === "object" ? (conversation.tenant as Tenant | null) : null;
    threads.push({
      id: conversation.id,
      type: conversation.type,
      title: await threadTitle(ctx, actor, conversation),
      avatarUrl: actor.side === "buyer" && conversation.type === "store" ? mediaUrl(store?.logo) : null,
      storeSlug: conversation.type === "store" ? (store?.slug ?? null) : null,
      preview: isCleared(conversation) ? "Old messages were cleared" : (conversation.lastMessagePreview ?? ""),
      lastMessageAt: conversation.lastMessageAt ?? null,
      unread: isUnreadFor(actor, conversation),
    });
  }
  return threads;
};

export const unreadCount = async (ctx: ChatCtx, actor: ChatActor) =>
  (await listThreads(ctx, actor)).filter((thread) => thread.unread).length;

export type ChatMessage = {
  id: string;
  side: Message["side"];
  mine: boolean;
  kind: Message["kind"];
  text: string | null;
  // Order cards + payment receipts (Phase 5): the store order they belong to
  storeOrderId: string | null;
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
  storeOrderId: relationId(message.storeOrder),
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
  const title = await threadTitle(ctx, actor, conversation);
  let header;
  if (conversation.type === "trip") {
    header = {
      id: conversation.id,
      type: "trip" as const,
      mySide: actor.side,
      title,
      storeSlug: null as string | null,
      avatarUrl: null as string | null,
      // Read-only once the trip has ended (CLAUDE.md §11.3)
      canSend: !conversation.closedAt,
    };
  } else {
    const store = await findStore(ctx, { id: relationId(conversation.tenant) ?? "" });
    header = {
      id: conversation.id,
      type: "store" as const,
      mySide: actor.side,
      title,
      storeSlug: store?.slug ?? null,
      avatarUrl: actor.side === "buyer" ? mediaUrl(store?.logo) : null,
      // Buyers can only write to stores that are open on DigiMall
      canSend: actor.side === "store" || Boolean(store && isPublicStatus(store.status)),
    };
  }
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
    data: { [READ_FIELD[actor.side]]: new Date().toISOString() },
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
    const target = await findStore(ctx, { slug: input.storeSlug });
    if (!target || !isPublicStatus(target.status)) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
    conversation = await ensureStoreConversation(ctx, actor.userId, target.id);
  } else {
    throw notFound();
  }

  let store: Tenant | null = null;
  if (conversation.type === "trip") {
    if (conversation.closedAt) throw new TRPCError({ code: "FORBIDDEN", message: "This trip has ended. The chat is read-only now." });
    if (input.productId) throw new TRPCError({ code: "BAD_REQUEST", message: "Product cards are for store chats." });
  } else {
    store = await findStore(ctx, { id: relationId(conversation.tenant) ?? "" });
    if (actor.side === "buyer" && !(store && isPublicStatus(store.status))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This store isn't available on DigiMall right now." });
    }
  }

  // 2. Expired chat: clear the old messages first, then start fresh (lazy cleanup)
  if (isCleared(conversation)) await deleteMessagesOf(ctx, conversation.id);

  // 3. Check attachments before saving anything
  let product: { id: string; name: string; price: number } | null = null;
  if (input.productId) {
    const found = (await payload.findByID({ collection: "products", id: input.productId, depth: 0, overrideAccess: true, req }).catch(() => null)) as
      | { id: string; name: string; price: number; tenant: unknown; isHidden?: boolean | null }
      | null;
    if (!found || found.isHidden || relationId(found.tenant) !== relationId(conversation.tenant)) {
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

  // 5. Thread summary, unread markers, the new delete date, and a push to the other side
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
      [READ_FIELD[actor.side]]: now.toISOString(),
      deleteAfter: new Date(now.getTime() + chatRetentionDays * 86_400_000).toISOString(),
    },
    overrideAccess: true,
    req,
  });
  for (const side of otherSides(conversation, actor.side)) await notifySide(ctx, conversation, side, preview);
  return { conversationId: conversation.id };
};

// ---------- used by orders + trips (order cards, receipts, status messages) ----------

// The store chat between a buyer and a store, created if it doesn't exist yet
export const ensureStoreConversation = async ({ payload, req }: ChatCtx, buyerId: string, tenantId: string): Promise<Conversation> => {
  const threadKey = threadKeyFor(buyerId, tenantId);
  const find = async () =>
    (await payload.find({ collection: "conversations", where: { threadKey: { equals: threadKey } }, depth: 0, limit: 1, overrideAccess: true, req }))
      .docs[0] as Conversation | undefined;
  const existing = await find();
  if (existing) return existing;
  try {
    return (await payload.create({ collection: "conversations", data: { threadKey, type: "store", buyer: buyerId, tenant: tenantId }, overrideAccess: true, req })) as Conversation;
  } catch {
    // Two first messages at the same moment: the unique threadKey lets only one create it
    const raced = await find();
    if (!raced) throw notFound();
    return raced;
  }
};

// The trip chat of an order (buyer + assigned rider), created when the rider accepts
export const ensureTripConversation = async ({ payload, req }: ChatCtx, order: Order, riderId: string): Promise<Conversation> => {
  const threadKey = tripThreadKey(order.id);
  const existing = (await payload.find({ collection: "conversations", where: { threadKey: { equals: threadKey } }, depth: 0, limit: 1, overrideAccess: true, req })).docs[0] as
    | Conversation
    | undefined;
  if (existing) return existing;
  return (await payload.create({
    collection: "conversations",
    data: { threadKey, type: "trip", buyer: relationId(order.buyer)!, rider: riderId, order: order.id },
    overrideAccess: true,
    req,
  })) as Conversation;
};

// Trip ended: the trip chat becomes read-only
export const closeConversation = async ({ payload, req }: ChatCtx, conversationId: string) => {
  await payload.update({ collection: "conversations", id: conversationId, data: { closedAt: new Date().toISOString() }, overrideAccess: true, req });
};

export type PostInput = {
  side: Message["side"];
  kind: Message["kind"];
  text?: string;
  senderId?: string;
  storeOrderId?: string;
  imageId?: string;
  preview: string;
  // Who should see it as a new message (badge + bold in the list + a phone notification)
  notify: ChatSide;
};

// Posts one message from server code (not typed by a person) and updates the chat summary
export const postChatMessage = async (ctx: ChatCtx, conversation: Conversation, input: PostInput) => {
  const { payload, req } = ctx;
  if (isCleared(conversation)) await deleteMessagesOf(ctx, conversation.id);
  await payload.create({
    collection: "messages",
    data: {
      conversation: conversation.id,
      side: input.side,
      sender: input.senderId,
      kind: input.kind,
      text: input.text,
      storeOrder: input.storeOrderId,
      image: input.imageId,
    },
    overrideAccess: true,
    req,
  });
  const now = new Date().toISOString();
  const { chatRetentionDays } = await getSettings(payload);
  // Marked read for everyone except the side we want to notify
  const readFor = otherSides(conversation, input.notify);
  await payload.update({
    collection: "conversations",
    id: conversation.id,
    data: {
      lastMessageAt: now,
      lastMessagePreview: input.preview.slice(0, 100),
      lastSenderSide: "system",
      ...Object.fromEntries(readFor.map((side) => [READ_FIELD[side], now])),
      deleteAfter: new Date(Date.now() + chatRetentionDays * 86_400_000).toISOString(),
    },
    overrideAccess: true,
    req,
  });
  await notifySide(ctx, conversation, input.notify, input.preview);
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
