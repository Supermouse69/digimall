// Run: bun run test:orders
// Phase 5 checkout + store order flow, end to end on the real dev database inside transactions
// that are cancelled (nothing is saved): server-side prices, max stores, fare estimate, order
// cards in chat, confirm (needs an approved GCash QR), pay with receipt, payment received,
// cancel rules, timers, "ready to book", and who may see what.
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { Tenant, User } from "../src/payload-types";
import { chatActorFor, getThread, type ChatActor, type ChatCtx } from "../src/modules/chat/server/chat-service";
import {
  actOnStoreOrder,
  buyerOrderDetail,
  cancelWholeOrder,
  placeOrder,
  previewCheckout,
  storeAttentionCount,
  storeBoard,
  storeOrderView,
} from "../src/modules/orders/server/order-service";
import { DEFAULT_SERVICE_CENTER } from "../src/globals/Settings";
import { isOrderCode } from "../src/modules/orders/state";

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};
const refusedWith = (promise: Promise<unknown>) => promise.then(() => "", (error: Error) => error.message || "refused");

const payload = await getPayload({ config });
await Promise.all(
  Object.values(payload.db.collections).map((model) => (model as { init: () => Promise<unknown> }).init()),
);
const STAMP = Date.now();
const BARANGAY = "San Marcos";

type World = {
  ctx: ChatCtx;
  req: PayloadRequest;
  stores: Tenant[];
  buyer: ChatActor;
  otherBuyer: ChatActor;
  sellerA: ChatActor;
  sellerB: ChatActor;
  products: Record<string, string>;
  buyerUser: User;
};

const scenario = async (name: string, run: (w: World) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  try {
    const user = async (tag: string, data: Record<string, unknown>) =>
      (await payload.create({
        collection: "users",
        data: { email: `order-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, _verified: true, ...data } as never,
        disableVerificationEmail: true,
        req,
      })) as User;
    const stores: Tenant[] = [];
    for (const letter of ["a", "b", "c", "d"]) {
      stores.push((await payload.create({ collection: "tenants", data: { name: `Order Store ${letter} ${STAMP}`, slug: `order-${letter}-${STAMP}`, status: "unverified", barangay: BARANGAY }, req })) as Tenant);
    }
    const sellerAUser = await user("seller-a", { name: "Seller A", role: "seller", tenants: [{ tenant: stores[0]!.id }] });
    const sellerBUser = await user("seller-b", { name: "Seller B", role: "seller", tenants: [{ tenant: stores[1]!.id }] });
    // Store A has an approved GCash QR; store B has none
    const qr = (await payload.db.create({ collection: "private-media", data: { owner: sellerAUser.id, purpose: "store-gcash-qr", filename: `qr-${STAMP}.webp`, mimeType: "image/webp" }, req })) as { id: string };
    // (database-level: as if the seller uploaded it and the super-admin approved it)
    await payload.db.updateOne({ collection: "tenants", id: stores[0]!.id, data: { gcashQr: qr.id, gcashQrApproved: true }, req });
    const buyerUser = await user("buyer", {
      name: "Juan Dela Cruz",
      role: "buyer",
      phone: "09171234567",
      buyerProfile: { barangay: BARANGAY, addressDetails: "Purok 3", location: [DEFAULT_SERVICE_CENTER.lng, DEFAULT_SERVICE_CENTER.lat] },
    });
    const otherBuyerUser = await user("buyer2", { name: "Maria", role: "buyer" });
    const category = await payload.create({ collection: "categories", data: { name: `Order Cat ${STAMP}`, slug: `order-cat-${STAMP}` }, req });
    const product = async (store: Tenant, name: string, price: number, isAvailable = true) =>
      (await payload.create({ collection: "products", data: { name, price, tenant: store.id, category: category.id, isAvailable }, req })).id;
    const products = {
      milk: await product(stores[0]!, "Bear Brand", 15),
      soldOut: await product(stores[0]!, "Sold out item", 50, false),
      bread: await product(stores[1]!, "Pandesal", 20),
      soap: await product(stores[2]!, "Soap", 30),
      rice: await product(stores[3]!, "Rice", 50),
    };
    await payload.create({ collection: "fares", data: { fromBarangay: BARANGAY, toBarangay: BARANGAY, casualFare: 30, fastFare: 50 }, req });
    await run({
      ctx: { payload, req },
      req,
      stores,
      buyer: chatActorFor(buyerUser)!,
      otherBuyer: chatActorFor(otherBuyerUser)!,
      sellerA: chatActorFor(sellerAUser)!,
      sellerB: chatActorFor(sellerBUser)!,
      products,
      buyerUser,
    });
  } catch (error) {
    check(`${name}: unexpected error`, false, (error as Error).message);
  } finally {
    await killTransaction(req);
  }
};

const cart = (w: World, picks: [number, string, number][]) => {
  const byStore = new Map<string, { productId: string; qty: number }[]>();
  for (const [storeIndex, product, qty] of picks) {
    const slug = w.stores[storeIndex]!.slug;
    byStore.set(slug, [...(byStore.get(slug) ?? []), { productId: w.products[product]!, qty }]);
  }
  return [...byStore.entries()].map(([storeSlug, items]) => ({ storeSlug, items }));
};

const storeOrdersOf = async (w: World, code: string) => (await buyerOrderDetail(w.ctx, w.buyer, code)).storeOrders;

await scenario("checkout", async (w) => {
  const preview = await previewCheckout(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 2], [1, "bread", 1]]), mode: "casual" });
  check("preview: no problems with a good cart", preview.problems.length === 0, preview.problems);
  check("preview: prices come from the database (2 x ₱15 + ₱20 = ₱50)", preview.itemsTotal === 50, preview.itemsTotal);
  check("fare estimate: casual ₱30 + 1 extra stop x ₱0 (Settings) = ₱30", preview.fare.estimate === 30, preview.fare);
  const fast = await previewCheckout(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1]]), mode: "fast" });
  check("fare estimate: fast = ₱50", fast.fare.estimate === 50, fast.fare);

  check("4 stores in one cart is refused (max 3)", (await refusedWith(placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1], [1, "bread", 1], [2, "soap", 1], [3, "rice", 1]]), mode: "casual" }))).includes("up to 3"));
  check("an unavailable item is refused", (await refusedWith(placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "soldOut", 1]]), mode: "casual" }))).includes("isn't available"));
  check("a seller can't place orders", (await refusedWith(placeOrder(w.ctx, w.sellerA, { stores: cart(w, [[0, "milk", 1]]), mode: "casual" }))) !== "");
  check("a buyer without phone/address is asked to complete it", (await refusedWith(placeOrder(w.ctx, w.otherBuyer, { stores: cart(w, [[0, "milk", 1]]), mode: "casual" }))) !== "");
  check(
    "a delivery pin outside the area is refused",
    (await refusedWith(placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1]]), mode: "casual", delivery: { location: { lat: 14.5995, lng: 120.9842 } } }))) !== "",
  );

  const { code } = await placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 2], [1, "bread", 1]]), mode: "casual", riderNotes: "Blue gate" });
  check("order code looks like DM-XXXX (no look-alike letters)", isOrderCode(code), code);
  const detail = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("one store order per store: -A and -B", detail.storeOrders.map((so) => so.code).join(",") === `${code}-A,${code}-B`);
  check("each store order waits for the store, with a timer", detail.storeOrders.every((so) => so.status === "awaiting_store" && Boolean(so.expiresAt)));
  check("snapshot keeps name, price, quantity", detail.storeOrders[0]!.items[0]?.name === "Bear Brand" && detail.storeOrders[0]!.items[0]?.qty === 2 && detail.storeOrders[0]!.subtotal === 30);
  check("parent order is in progress", detail.status === "in_progress");

  const card = (await getThread(w.ctx, w.sellerA, detail.storeOrders[0]!.conversationId!)).messages.find((m) => m.kind === "order_card");
  check("an order card is posted in the buyer's chat with that store", Boolean(card?.storeOrderId));
  check("the store's bubble counts 1 order to act on", (await storeAttentionCount(w.ctx, w.sellerA)) === 1);
  const sellerView = await storeOrderView(w.ctx, w.sellerA, detail.storeOrders[0]!.id);
  check("the store sees the buyer's name + barangay, not the address", sellerView.order.buyerName === "Juan Dela Cruz" && sellerView.order.barangay === BARANGAY && !JSON.stringify(sellerView).includes("Purok 3"));
  check("the store never sees its own QR link on the order", sellerView.gcashQrUrl === null);

  check("another buyer can't see the order", (await refusedWith(buyerOrderDetail(w.ctx, w.otherBuyer, code))) !== "");
  check("another store can't see store A's part", (await refusedWith(storeOrderView(w.ctx, w.sellerB, detail.storeOrders[0]!.id))) !== "");
  check("another store can't act on it", (await refusedWith(actOnStoreOrder(w.ctx, w.sellerB, detail.storeOrders[0]!.id, "store_confirm"))) !== "");
  check("the buyer can't do the store's steps", (await refusedWith(actOnStoreOrder(w.ctx, w.buyer, detail.storeOrders[0]!.id, "store_confirm"))) !== "");
});

await scenario("pay flow", async (w) => {
  const { code } = await placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 2], [1, "bread", 1]]), mode: "fast" });
  const [a, b] = await storeOrdersOf(w, code);

  check("store B without an approved GCash QR can't confirm", (await refusedWith(actOnStoreOrder(w.ctx, w.sellerB, b!.id, "store_confirm"))).includes("GCash QR"));
  check("store cancel needs a reason", (await refusedWith(actOnStoreOrder(w.ctx, w.sellerB, b!.id, "store_cancel"))).includes("why"));

  await actOnStoreOrder(w.ctx, w.sellerA, a!.id, "store_confirm");
  const afterConfirm = (await storeOrdersOf(w, code))[0]!;
  check("confirmed: waiting for payment with a new timer", afterConfirm.status === "awaiting_payment" && Boolean(afterConfirm.expiresAt));
  check("the buyer now sees the store's approved GCash QR", Boolean(afterConfirm.gcashQrUrl), afterConfirm.gcashQrUrl);
  const privateRead = payload.collections["private-media"].config.access.read!;
  w.req.user = { ...w.buyerUser, collection: "users" } as never;
  const rule = JSON.stringify(await privateRead({ req: w.req } as never));
  w.req.user = null;
  const storeA = (await payload.findByID({ collection: "tenants", id: w.stores[0]!.id, depth: 0, req: w.req })) as Tenant;
  check("file access: the buyer may open that QR while paying", rule.includes(String(storeA.gcashQr)), rule);

  check("submitting payment without a receipt is refused", (await refusedWith(actOnStoreOrder(w.ctx, w.buyer, a!.id, "submit_payment"))).includes("receipt"));
  const notMine = (await payload.db.create({ collection: "private-media", data: { owner: w.sellerA.userId, purpose: "payment-receipt", filename: `x-${STAMP}.webp`, mimeType: "image/webp" }, req: w.req })) as { id: string };
  check("someone else's file as receipt is refused", (await refusedWith(actOnStoreOrder(w.ctx, w.buyer, a!.id, "submit_payment", { receiptId: notMine.id }))) !== "");
  const receipt = (await payload.db.create({ collection: "private-media", data: { owner: w.buyer.userId, purpose: "payment-receipt", filename: `r-${STAMP}.webp`, mimeType: "image/webp" }, req: w.req })) as { id: string };
  await actOnStoreOrder(w.ctx, w.buyer, a!.id, "submit_payment", { receiptId: receipt.id, referenceNo: "1234 5678 9012" });
  const afterPay = (await storeOrdersOf(w, code))[0]!;
  check("receipt sent: status = payment submitted, timer STOPPED", afterPay.status === "payment_submitted" && afterPay.expiresAt === null);
  check("reference number saved without spaces", afterPay.referenceNo === "123456789012", afterPay.referenceNo);
  const sellerSees = await storeOrderView(w.ctx, w.sellerA, a!.id);
  check("the store sees the receipt", Boolean(sellerSees.receiptUrl));
  const linked = (await payload.findByID({ collection: "private-media", id: receipt.id, depth: 0, req: w.req })) as { conversation?: unknown };
  check("receipt file is linked to the store chat (that's how the store may open it)", String(linked.conversation) === sellerSees.conversationId);
  check("the buyer can't cancel after paying (refunds = Phase 7)", (await refusedWith(actOnStoreOrder(w.ctx, w.buyer, a!.id, "buyer_cancel"))).includes("already paid"));

  await actOnStoreOrder(w.ctx, w.sellerA, a!.id, "payment_not_received");
  const flagged = await storeOrderView(w.ctx, w.sellerA, a!.id);
  check("'not received': flagged, status unchanged", flagged.paymentNotReceived && flagged.status === "payment_submitted");
  await actOnStoreOrder(w.ctx, w.sellerA, a!.id, "payment_received");
  const detail = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("payment received: A is paid", detail.storeOrders[0]!.status === "paid");
  check("B still waiting -> order NOT ready to book", detail.status === "in_progress");
  check("paid: the QR is no longer shown", detail.storeOrders[0]!.gcashQrUrl === null);

  await actOnStoreOrder(w.ctx, w.buyer, b!.id, "buyer_cancel", { reason: "Changed my mind" });
  const ready = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("buyer removes the stuck store -> order READY TO BOOK", ready.status === "ready_to_book", ready.status);
  check("store A's board shows the paid order", (await storeBoard(w.ctx, w.sellerA)).some((so) => so.id === a!.id && so.status === "paid"));
  const thread = await getThread(w.ctx, w.buyer, a!.conversationId!);
  check("the chat has the order card, receipt and status messages", ["order_card", "payment_receipt"].every((kind) => thread.messages.some((m) => m.kind === kind)) && thread.messages.filter((m) => m.kind === "system").length >= 3);
});

await scenario("timers", async (w) => {
  const { code } = await placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1]]), mode: "casual" });
  const [a] = await storeOrdersOf(w, code);
  const past = new Date(Date.now() - 60_000).toISOString();
  await payload.update({ collection: "store-orders", id: a!.id, data: { expiresAt: past }, overrideAccess: true, req: w.req });
  const expired = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("store didn't confirm in time -> expired (on the next look)", expired.storeOrders[0]!.status === "expired");
  check("...and the order is cancelled", expired.status === "cancelled");
  check("...the store can't confirm it anymore", (await refusedWith(actOnStoreOrder(w.ctx, w.sellerA, a!.id, "store_confirm"))) !== "");

  const second = await placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1]]), mode: "casual" });
  const [b] = await storeOrdersOf(w, second.code);
  await actOnStoreOrder(w.ctx, w.sellerA, b!.id, "store_confirm");
  await payload.update({ collection: "store-orders", id: b!.id, data: { expiresAt: past }, overrideAccess: true, req: w.req });
  check("buyer didn't pay in time -> cancelled", (await storeOrderView(w.ctx, w.sellerA, b!.id)).status === "cancelled");
});

await scenario("cancel whole order", async (w) => {
  const { code } = await placeOrder(w.ctx, w.buyer, { stores: cart(w, [[0, "milk", 1], [2, "soap", 1]]), mode: "casual" });
  const result = await cancelWholeOrder(w.ctx, w.buyer, code, "Wrong address");
  const detail = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("cancel whole order: both store orders cancelled", result.cancelled === 2 && detail.storeOrders.every((so) => so.status === "cancelled"), result);
  check("...and the order is cancelled", detail.status === "cancelled");
  check("the store's bubble no longer counts it", (await storeAttentionCount(w.ctx, w.sellerA)) === 0);
});

const leftovers = await payload.find({ collection: "users", where: { email: { like: `order-` } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
