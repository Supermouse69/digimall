// Run: bun run test:chat
// Phase 4 store chat rules, on the real dev database inside transactions that are cancelled
// (nothing is saved): one thread per buyer + store, only members can read/write, stores see the
// username/first name only, unread markers, product cards, private chat photos, stores that
// go offline, the 90-day lazy cleanup, and reported chats being kept.
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { Tenant, User } from "../src/payload-types";
import {
  chatActorFor,
  flagConversationForReport,
  getThread,
  listThreads,
  loadConversationFor,
  markRead,
  purgeExpiredChats,
  sendMessage,
  unreadCount,
  type ChatActor,
  type ChatCtx,
} from "../src/modules/chat/server/chat-service";

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};
const refused = (promise: Promise<unknown>) => promise.then(() => false, () => true);

const payload = await getPayload({ config });
await Promise.all(
  Object.values(payload.db.collections).map((model) => (model as { init: () => Promise<unknown> }).init()),
);
const STAMP = Date.now();

type World = {
  ctx: ChatCtx;
  req: PayloadRequest;
  store: Tenant;
  otherStore: Tenant;
  buyer: ChatActor;
  buyerB: ChatActor;
  seller: ChatActor;
  otherSeller: ChatActor;
  productId: string;
  otherProductId: string;
  buyerUser: User;
};

const scenario = async (name: string, run: (w: World) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  try {
    const mk = async (collection: "tenants" | "categories", data: Record<string, unknown>) =>
      payload.create({ collection, data: data as never, req, overrideAccess: true });
    const store = (await mk("tenants", { name: `Chat Store ${STAMP}`, slug: `chat-store-${STAMP}`, status: "unverified" })) as Tenant;
    const otherStore = (await mk("tenants", { name: `Other Store ${STAMP}`, slug: `chat-other-${STAMP}`, status: "unverified" })) as Tenant;
    const category = await mk("categories", { name: `Chat Cat ${STAMP}`, slug: `chat-cat-${STAMP}` });
    const user = async (tag: string, data: Record<string, unknown>) =>
      (await payload.create({
        collection: "users",
        data: { email: `chat-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, _verified: true, ...data } as never,
        disableVerificationEmail: true,
        req,
      })) as User;
    const buyerUser = await user("buyer", { name: "Juan Dela Cruz", chatName: "juan_23", role: "buyer" });
    const buyerBUser = await user("buyerb", { name: "Maria Santos", role: "buyer" });
    const sellerUser = await user("seller", { name: "Store Owner", role: "seller", tenants: [{ tenant: store.id }] });
    const otherSellerUser = await user("other", { name: "Other Owner", role: "seller", tenants: [{ tenant: otherStore.id }] });
    const product = await payload.create({ collection: "products", data: { name: "Bear Brand 33g", price: 15, tenant: store.id, category: category.id }, req });
    const otherProduct = await payload.create({ collection: "products", data: { name: "Other item", price: 20, tenant: otherStore.id, category: category.id }, req });
    await run({
      ctx: { payload, req },
      req,
      store,
      otherStore,
      buyer: chatActorFor(buyerUser)!,
      buyerB: chatActorFor(buyerBUser)!,
      seller: chatActorFor(sellerUser)!,
      otherSeller: chatActorFor(otherSellerUser)!,
      productId: product.id,
      otherProductId: otherProduct.id,
      buyerUser,
    });
  } catch (error) {
    check(`${name}: unexpected error`, false, (error as Error).message);
  } finally {
    await killTransaction(req);
  }
};

const fakeFile = (req: PayloadRequest, ownerId: string, purpose: string) =>
  payload.db.create({
    collection: "private-media",
    data: { owner: ownerId, purpose, filename: `chat-test-${STAMP}-${Math.random().toString(36).slice(2)}.webp`, mimeType: "image/webp" },
    req,
  }) as Promise<{ id: string }>;

await scenario("threads", async ({ ctx, store, buyer, buyerB, seller, otherSeller, productId, otherProductId }) => {
  const first = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "May stock pa po?", productId });
  const again = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "Hello ulit" });
  check("one thread per buyer + store", first.conversationId === again.conversationId);

  const thread = await getThread(ctx, buyer, first.conversationId);
  check("product card + 2 messages saved, in order", thread.messages.map((m) => m.kind).join(",") === "product_ref,text,text", thread.messages.map((m) => m.kind));
  check("product card keeps name + price", thread.messages[0]?.product?.name === "Bear Brand 33g" && thread.messages[0]?.product?.price === 15);

  check("another buyer can't open this chat", await refused(loadConversationFor(ctx, buyerB, first.conversationId)));
  check("another store's seller can't open it", await refused(loadConversationFor(ctx, otherSeller, first.conversationId)));
  check("another store's seller can't write in it", await refused(sendMessage(ctx, otherSeller, { conversationId: first.conversationId, text: "hi" })));
  check("another buyer's list doesn't show it", (await listThreads(ctx, buyerB)).length === 0);

  const sellerList = await listThreads(ctx, seller);
  check("store sees the buyer's username (not full name)", sellerList[0]?.title === "juan_23", sellerList[0]?.title);
  check("store sees it as unread", sellerList[0]?.unread === true && (await unreadCount(ctx, seller)) === 1);
  check("buyer doesn't see own message as unread", (await unreadCount(ctx, buyer)) === 0);

  await sendMessage(ctx, seller, { conversationId: first.conversationId, text: "Meron po!" });
  check("seller's reply: store is no longer unread", (await unreadCount(ctx, seller)) === 0);
  check("seller's reply: buyer now has 1 unread", (await unreadCount(ctx, buyer)) === 1);
  await markRead(ctx, buyer, first.conversationId);
  check("buyer opens it: unread goes back to 0", (await unreadCount(ctx, buyer)) === 0);

  check("product from another store is refused", await refused(sendMessage(ctx, buyer, { conversationId: first.conversationId, productId: otherProductId })));
  check("empty message is refused", await refused(sendMessage(ctx, buyer, { conversationId: first.conversationId, text: "   " })));
  check("sellers can't start chats with other stores", await refused(sendMessage(ctx, seller, { storeSlug: store.slug, text: "x" })));
});

await scenario("first name fallback", async ({ ctx, store, buyerB, seller }) => {
  await sendMessage(ctx, buyerB, { storeSlug: store.slug, text: "Hi" });
  check("no username: store sees first name only", (await listThreads(ctx, seller))[0]?.title === "Maria");
});

await scenario("photos", async ({ ctx, req, store, buyer, seller }) => {
  const { conversationId } = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "Hi" });
  const photo = await fakeFile(req, buyer.userId, "chat-image");
  await sendMessage(ctx, buyer, { conversationId, imageId: photo.id });
  const file = (await payload.findByID({ collection: "private-media", id: photo.id, depth: 0, req })) as { conversation?: unknown };
  check("sent photo is linked to the chat (so the store may see it)", String(file.conversation) === conversationId);

  const privateRead = payload.collections["private-media"].config.access.read!;
  req.user = { ...(await payload.findByID({ collection: "users", id: seller.userId, depth: 0, req })), collection: "users" } as never;
  const sellerRule = JSON.stringify(await privateRead({ req } as never));
  check("store's file access includes this chat's photos", sellerRule.includes(conversationId), sellerRule);
  req.user = null;

  const someoneElses = await fakeFile(req, seller.userId, "chat-image");
  check("buyer can't send someone else's photo", await refused(sendMessage(ctx, buyer, { conversationId, imageId: someoneElses.id })));
  const wrongPurpose = await fakeFile(req, buyer.userId, "landmark");
  check("buyer can't send a private file meant for something else", await refused(sendMessage(ctx, buyer, { conversationId, imageId: wrongPurpose.id })));
});

await scenario("store offline", async ({ ctx, req, store, buyer, seller }) => {
  const { conversationId } = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "Hi" });
  await payload.update({ collection: "tenants", id: store.id, data: { status: "suspended" }, overrideAccess: true, req });
  check("suspended store: buyer can't write", await refused(sendMessage(ctx, buyer, { conversationId, text: "hello?" })));
  check("...and the chat says so (can't send)", (await getThread(ctx, buyer, conversationId)).canSend === false);
  check("...buyer can't start a new chat with it either", await refused(sendMessage(ctx, buyer, { storeSlug: store.slug, text: "x" })));
  check("the store can still answer existing chats", !(await refused(sendMessage(ctx, seller, { conversationId, text: "Sorry, closed muna" }))));
});

await scenario("cleanup", async ({ ctx, req, store, buyer }) => {
  const { conversationId } = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "Old message" });
  const conv = await payload.findByID({ collection: "conversations", id: conversationId, depth: 0, req });
  const days = Math.round((Date.parse(conv.deleteAfter!) - Date.now()) / 86_400_000);
  check("delete date is set from Settings (90 days)", days === 90, days);

  const past = new Date(Date.now() - 60_000).toISOString();
  await payload.update({ collection: "conversations", id: conversationId, data: { deleteAfter: past }, overrideAccess: true, req });
  const cleared = await getThread(ctx, buyer, conversationId);
  check("past the delete date: messages are hidden right away", cleared.cleared && cleared.messages.length === 0);
  await sendMessage(ctx, buyer, { conversationId, text: "New message" });
  const fresh = await getThread(ctx, buyer, conversationId);
  check("writing again: the old messages are deleted, the chat starts fresh", fresh.messages.length === 1 && fresh.messages[0]?.text === "New message", fresh.messages.map((m) => m.text));

  await payload.update({ collection: "conversations", id: conversationId, data: { deleteAfter: past }, overrideAccess: true, req });
  await flagConversationForReport(ctx, buyer, conversationId);
  const kept = await purgeExpiredChats(ctx);
  const stillThere = await payload.find({ collection: "conversations", where: { id: { equals: conversationId } }, depth: 0, req });
  check("a REPORTED chat is not deleted by the cleanup", stillThere.docs.length === 1 && kept.conversations === 0, kept);
  check("...and its messages stay readable", (await getThread(ctx, buyer, conversationId)).messages.length === 1);

  await payload.update({ collection: "conversations", id: conversationId, data: { underReport: false }, overrideAccess: true, req });
  const purged = await purgeExpiredChats(ctx);
  const gone = await payload.find({ collection: "conversations", where: { id: { equals: conversationId } }, depth: 0, req });
  const messagesLeft = await payload.find({ collection: "messages", where: { conversation: { equals: conversationId } }, depth: 0, req });
  check("after the report: cleanup deletes the chat and its messages", gone.docs.length === 0 && messagesLeft.docs.length === 0 && purged.conversations >= 1, purged);
});

await scenario("report rules", async ({ ctx, store, buyer, buyerB }) => {
  const { conversationId } = await sendMessage(ctx, buyer, { storeSlug: store.slug, text: "Hi" });
  check("someone outside the chat can't report (flag) it", await refused(flagConversationForReport(ctx, buyerB, conversationId)));
});

const leftovers = await payload.find({ collection: "users", where: { email: { like: `chat-` } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))), leftovers.docs.length);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
