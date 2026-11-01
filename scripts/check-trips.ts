// Run: bun run test:trips
// Phase 6 rider booking + trips, end to end on the real dev database inside transactions that are
// cancelled (nothing is saved): who can go Active, the rider list (approved, Active, fresh location,
// nearest first), requests + decline + timeout + auto-pick, accept, pickup, delivered, and what each
// person sees before / during / after the trip.
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { Tenant, User } from "../src/payload-types";
import { DEFAULT_SERVICE_CENTER } from "../src/globals/Settings";
import { chatActorFor, getThread, loadConversationFor, sendMessage, type ChatActor, type ChatCtx } from "../src/modules/chat/server/chat-service";
import { actOnStoreOrder, buyerOrderDetail, placeOrder } from "../src/modules/orders/server/order-service";
import {
  buyerTrip,
  cancelRiderRequest,
  deliver,
  incomingRequest,
  listBookableRiders,
  pickUp,
  requestRider,
  respondToRequest,
  riderHistory,
  riderTrip,
  setActive,
} from "../src/modules/trips/server/trip-service";

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
const C = DEFAULT_SERVICE_CENTER;

type World = {
  ctx: ChatCtx;
  req: PayloadRequest;
  store: Tenant;
  buyer: ChatActor;
  otherBuyer: ChatActor;
  seller: ChatActor;
  near: ChatActor;
  far: ChatActor;
  pendingRider: ChatActor;
  staleRider: ChatActor;
  landmarkId: string;
  readyOrder: () => Promise<string>;
};

const scenario = async (name: string, run: (w: World) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  const ctx = { payload, req };
  try {
    const user = async (tag: string, data: Record<string, unknown>) =>
      (await payload.create({
        collection: "users",
        data: { email: `trip-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, _verified: true, ...data } as never,
        disableVerificationEmail: true,
        req,
      })) as User;
    const store = (await payload.create({
      collection: "tenants",
      data: { name: `Trip Store ${STAMP}`, slug: `trip-store-${STAMP}`, status: "unverified", barangay: "San Marcos", location: [C.lng, C.lat], phone: "09170000001" },
      req,
    })) as Tenant;
    const seller = await user("seller", { name: "Seller", role: "seller", tenants: [{ tenant: store.id }] });
    const qr = (await payload.db.create({ collection: "private-media", data: { owner: seller.id, purpose: "store-gcash-qr", filename: `tqr-${STAMP}.webp`, mimeType: "image/webp" }, req })) as { id: string };
    await payload.db.updateOne({ collection: "tenants", id: store.id, data: { gcashQr: qr.id, gcashQrApproved: true }, req });
    const buyerUser = await user("buyer", { name: "Juan Dela Cruz", role: "buyer", phone: "09171234567", buyerProfile: { barangay: "San Marcos", addressDetails: "Purok 3, blue gate", location: [C.lng, C.lat] } });
    const landmark = (await payload.db.create({ collection: "private-media", data: { owner: buyerUser.id, purpose: "landmark", filename: `lm-${STAMP}.webp`, mimeType: "image/webp" }, req })) as { id: string };
    // As the buyer (the "you can only attach your own file" rule checks who is saving)
    await payload.update({
      collection: "users",
      id: buyerUser.id,
      data: { buyerProfile: { barangay: "San Marcos", addressDetails: "Purok 3, blue gate", location: [C.lng, C.lat], landmarkPhoto: landmark.id } },
      user: { ...buyerUser, collection: "users" } as never,
      req,
    });
    req.user = null;
    const otherBuyer = await user("buyer2", { name: "Maria", role: "buyer" });
    const category = await payload.create({ collection: "categories", data: { name: `Trip Cat ${STAMP}`, slug: `trip-cat-${STAMP}` }, req });
    const product = await payload.create({ collection: "products", data: { name: "Bear Brand", price: 15, tenant: store.id, category: category.id }, req });
    await payload.create({ collection: "fares", data: { fromBarangay: "San Marcos", toBarangay: "San Marcos", casualFare: 30, fastFare: 50 }, req });

    const rider = async (tag: string, approved: boolean, offset: number, minutesAgo = 0) => {
      const u = await user(tag, { name: `${tag[0]!.toUpperCase()}${tag.slice(1)} Rider`, role: "rider", phone: "09179999999" });
      await payload.create({
        collection: "rider-profiles",
        data: { user: u.id, displayName: `${tag} rider`, status: approved ? "approved" : "pending" },
        req,
      });
      if (approved) {
        const profile = (await payload.find({ collection: "rider-profiles", where: { user: { equals: u.id } }, depth: 0, req })).docs[0]!;
        await payload.db.updateOne({
          collection: "rider-profiles",
          id: profile.id,
          data: { isActive: true, lastLocation: { lat: C.lat + offset, lng: C.lng, at: new Date(Date.now() - minutesAgo * 60_000).toISOString() } },
          req,
        });
      }
      return chatActorFor(u)!;
    };
    const near = await rider("near", true, 0.005);
    const far = await rider("far", true, 0.02);
    const pendingRider = await rider("pending", false, 0.001);
    const staleRider = await rider("stale", true, 0.001, 30);

    const buyer = chatActorFor(buyerUser)!;
    const sellerActor = chatActorFor(seller)!;
    // An order that is paid = ready to book a rider
    const readyOrder = async () => {
      const { code } = await placeOrder(ctx, buyer, { stores: [{ storeSlug: store.slug, items: [{ productId: product.id, qty: 2 }] }], mode: "fast" });
      const so = (await buyerOrderDetail(ctx, buyer, code)).storeOrders[0]!;
      await actOnStoreOrder(ctx, sellerActor, so.id, "store_confirm");
      const receipt = (await payload.db.create({ collection: "private-media", data: { owner: buyer.userId, purpose: "payment-receipt", filename: `tr-${STAMP}-${Math.random()}.webp`, mimeType: "image/webp" }, req })) as { id: string };
      await actOnStoreOrder(ctx, buyer, so.id, "submit_payment", { receiptId: receipt.id });
      await actOnStoreOrder(ctx, sellerActor, so.id, "payment_received");
      return code;
    };
    await run({ ctx, req, store, buyer, otherBuyer: chatActorFor(otherBuyer)!, seller: sellerActor, near, far, pendingRider, staleRider, landmarkId: landmark.id, readyOrder });
  } catch (error) {
    check(`${name}: unexpected error`, false, (error as Error).stack?.split("\n").slice(0, 3).join(" | "));
  } finally {
    await killTransaction(req);
  }
};

await scenario("going active", async (w) => {
  check("a rider who isn't approved can't go Active", (await refusedWith(setActive(w.ctx, w.pendingRider, true, C))).includes("approved"));
  check("going Active needs a location", (await refusedWith(setActive(w.ctx, w.near, true))).includes("location"));
  check("buyers can't use the rider switch", (await refusedWith(setActive(w.ctx, w.buyer, true, C))) !== "");
});

await scenario("booking", async (w) => {
  const code = await w.readyOrder();
  check("paid order = ready to book", (await buyerOrderDetail(w.ctx, w.buyer, code)).status === "ready_to_book");
  const list = await listBookableRiders(w.ctx, w.buyer, code);
  check("rider list: only approved, Active riders with a fresh location", list.map((r) => r.riderId).join() === [w.near.userId, w.far.userId].join(), list);
  check("nearest first, approximate distance like '~0.6 km'", /^~\d+(\.\d)? km$/.test(list[0]!.distance), list[0]?.distance);
  check("the list shows first name only (no phone, no surname)", list[0]!.firstName === "near" && !JSON.stringify(list).includes("0917"));
  check("another buyer can't see this order's rider list", (await refusedWith(listBookableRiders(w.ctx, w.otherBuyer, code))) !== "");

  await requestRider(w.ctx, w.buyer, code, { riderId: w.near.userId });
  const card = await incomingRequest(w.ctx, w.near);
  check("the rider gets the request with a countdown", Boolean(card?.expiresAt) && card?.code === code);
  check("before accepting: no street address, pin or phone", card !== null && !JSON.stringify(card).includes("Purok") && !JSON.stringify(card).includes("0917") && card.buyerBarangay === "San Marcos");
  check("another rider doesn't get it", (await incomingRequest(w.ctx, w.far)) === null);
  check("one pending request per order", (await refusedWith(requestRider(w.ctx, w.buyer, code, { riderId: w.far.userId }))).includes("already"));
  check("another rider can't answer it", (await refusedWith(respondToRequest(w.ctx, w.far, card!.orderId, true))) !== "");
  check("the busy rider isn't offered to other orders", !(await listBookableRiders(w.ctx, w.buyer, await w.readyOrder())).some((r) => r.riderId === w.near.userId));

  await respondToRequest(w.ctx, w.near, card!.orderId, false);
  check("rider declines -> back to 'ready to book'", (await buyerOrderDetail(w.ctx, w.buyer, code)).status === "ready_to_book");
  check("...and that rider isn't offered again for this order", !(await listBookableRiders(w.ctx, w.buyer, code)).some((r) => r.riderId === w.near.userId));

  await requestRider(w.ctx, w.buyer, code, { auto: true });
  check("auto-pick asks the nearest rider not tried yet", (await incomingRequest(w.ctx, w.far))?.code === code);
  const order = (await payload.find({ collection: "orders", where: { code: { equals: code } }, depth: 0, req: w.req })).docs[0]!;
  await payload.db.updateOne({ collection: "orders", id: order.id, data: { riderRequest: { ...order.riderRequest, expiresAt: new Date(Date.now() - 1000).toISOString() } }, req: w.req });
  const after = await buyerTrip(w.ctx, w.buyer, code);
  check("no answer in time + nobody left -> back to 'ready to book'", after.status === "ready_to_book", after);
  check("the timed-out rider can't accept anymore", (await refusedWith(respondToRequest(w.ctx, w.far, order.id, true))).includes("isn't yours"));

  const second = await w.readyOrder();
  await requestRider(w.ctx, w.buyer, second, { riderId: w.far.userId });
  await cancelRiderRequest(w.ctx, w.buyer, second);
  check("buyer cancels the request -> back to 'ready to book'", (await buyerOrderDetail(w.ctx, w.buyer, second)).status === "ready_to_book");
});

await scenario("trip", async (w) => {
  const code = await w.readyOrder();
  await requestRider(w.ctx, w.buyer, code, { riderId: w.near.userId });
  const card = (await incomingRequest(w.ctx, w.near))!;
  const { conversationId } = (await respondToRequest(w.ctx, w.near, card.orderId, true)) as { conversationId: string };
  check("accepted -> rider assigned", (await buyerOrderDetail(w.ctx, w.buyer, code)).status === "rider_assigned");

  const trip = (await riderTrip(w.ctx, w.near))!;
  check("during the trip the rider sees address, pin, notes and the buyer's phone", trip.buyer.addressDetails === "Purok 3, blue gate" && Boolean(trip.buyer.location) && trip.buyer.phone === "+639171234567");
  check("...and the store's phone (to call the store)", trip.stops[0]?.phone === "+639170000001", trip.stops[0]?.phone);
  check("...and the landmark photo", Boolean(trip.buyer.landmarkPhotoUrl));
  const privateRead = payload.collections["private-media"].config.access.read!;
  w.req.user = { ...(await payload.findByID({ collection: "users", id: w.near.userId, depth: 0, req: w.req })), collection: "users" } as never;
  check("file access: the rider may open the landmark photo during the trip", JSON.stringify(await privateRead({ req: w.req } as never)).includes(w.landmarkId));
  w.req.user = null;

  const buyerView = await buyerTrip(w.ctx, w.buyer, code);
  check("the buyer sees the rider's first name, phone and live location", buyerView.rider?.firstName === "near" && buyerView.rider?.phone === "+639179999999" && Boolean(buyerView.rider?.location), buyerView.rider);
  check("another rider sees no trip", (await riderTrip(w.ctx, w.far)) === null);
  check("another buyer can't see this trip", (await refusedWith(buyerTrip(w.ctx, w.otherBuyer, code))) !== "");
  check("the trip chat is for the buyer + rider only (not the store)", (await refusedWith(loadConversationFor(w.ctx, w.seller, conversationId))) !== "");
  await sendMessage(w.ctx, w.buyer, { conversationId, text: "Nasa gate na po ako" });
  check("buyer and rider can chat in the trip chat", (await getThread(w.ctx, w.near, conversationId)).messages.some((m) => m.text === "Nasa gate na po ako"));

  check("can't go off Active during a trip", (await refusedWith(setActive(w.ctx, w.near, false))).includes("Finish"));
  check("can't mark Delivered before picking up", (await refusedWith(deliver(w.ctx, w.near, card.orderId, 50))).includes("Pick up"));
  await pickUp(w.ctx, w.near, trip.stops[0]!.storeOrderId);
  check("first pickup -> order is ON THE WAY", (await buyerOrderDetail(w.ctx, w.buyer, code)).status === "on_the_way");
  check("store order is picked up", (await buyerOrderDetail(w.ctx, w.buyer, code)).storeOrders[0]!.status === "picked_up");

  check("fee must be whole pesos", (await refusedWith(deliver(w.ctx, w.near, card.orderId, 12.5))) !== "");
  await deliver(w.ctx, w.near, card.orderId, 45);
  const done = await buyerOrderDetail(w.ctx, w.buyer, code);
  check("delivered: order + store order delivered", done.status === "delivered" && done.storeOrders[0]!.status === "delivered");
  check("after delivery the rider no longer sees the address", (await riderTrip(w.ctx, w.near)) === null);
  w.req.user = { ...(await payload.findByID({ collection: "users", id: w.near.userId, depth: 0, req: w.req })), collection: "users" } as never;
  check("...nor the landmark photo", !JSON.stringify(await privateRead({ req: w.req } as never)).includes(w.landmarkId));
  w.req.user = null;
  const afterView = await buyerTrip(w.ctx, w.buyer, code);
  check("after delivery the buyer no longer sees the rider's phone or location", afterView.rider?.phone === null && afterView.rider?.location === null);
  check("the trip chat is read-only now", (await refusedWith(sendMessage(w.ctx, w.buyer, { conversationId, text: "thanks" }))).includes("read-only"));
  const history = await riderHistory(w.ctx, w.near);
  check("earnings log: the trip with the confirmed cash fee (₱45)", history.trips[0]?.code === code && history.total === 45 && !JSON.stringify(history).includes("Purok"));
  check("the rider can go off Active now", !(await refusedWith(setActive(w.ctx, w.near, false))));
});

const leftovers = await payload.find({ collection: "users", where: { email: { like: "trip-" } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
