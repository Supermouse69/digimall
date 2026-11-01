// Run: bun run test:privacy
// Privacy requests (CLAUDE.md §9): export a user's data + erase an account. Real dev database inside
// a transaction that is cancelled (nothing is saved).
import { getPayload, killTransaction } from "payload";

import config from "../src/payload.config";
import type { User } from "../src/payload-types";
import { startTransaction } from "../src/lib/transaction";
import { eraseUser, exportUserData } from "../src/modules/privacy/server/privacy-service";

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
const req = await startTransaction(payload);
const ctx = { payload, req };

try {
  const user = async (tag: string, data: Record<string, unknown>) =>
    (await payload.create({ collection: "users", data: { email: `privacy-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, _verified: true, ...data } as never, disableVerificationEmail: true, req })) as User;
  const admin = await user("admin", { name: "Admin", role: "super-admin" });
  const buyer = await user("buyer", { name: "Juan Dela Cruz", chatName: "juan_23", role: "buyer", phone: "09171234567", buyerProfile: { barangay: "San Marcos", addressDetails: "Purok 3" } });
  const seller = await user("seller", { name: "Seller", role: "seller" });
  const store = await payload.create({ collection: "tenants", data: { name: "Privacy Store", slug: `privacy-store-${STAMP}`, status: "unverified" }, req });
  const file = async (owner: string, purpose: string) =>
    ((await payload.db.create({ collection: "private-media", data: { owner, purpose, filename: `pv-${STAMP}-${Math.random().toString(36).slice(2)}.webp`, mimeType: "image/webp" }, req })) as { id: string }).id;
  const landmark = await file(buyer.id, "landmark");
  const chatPhoto = await file(buyer.id, "chat-image");
  const receipt = await file(buyer.id, "payment-receipt");

  const order = await payload.create({
    collection: "orders",
    data: { code: "DM-PPPP", buyer: buyer.id, mode: "casual", status: "delivered", delivery: { buyerName: "Juan Dela Cruz", barangay: "San Marcos", addressDetails: "Purok 3", landmarkPhoto: landmark }, riderNotes: "blue gate" },
    overrideAccess: true,
    req,
  });
  await payload.db.create({
    collection: "store-orders",
    data: { code: "DM-PPPP-A", order: order.id, suffix: "A", tenant: store.id, buyer: buyer.id, items: [{ name: "Rice", price: 60, qty: 1 }], subtotal: 60, status: "delivered", storeNotes: "no plastic", payment: { receipt } },
    req,
  });
  const chat = await payload.create({ collection: "conversations", data: { threadKey: `store:${buyer.id}:${store.id}`, type: "store", buyer: buyer.id, tenant: store.id, lastMessageAt: new Date().toISOString() }, overrideAccess: true, req });
  await payload.create({ collection: "messages", data: { conversation: chat.id, side: "buyer", sender: buyer.id, kind: "image", image: chatPhoto, text: "Is this the right one?" }, overrideAccess: true, req });
  const reported = await payload.create({ collection: "conversations", data: { threadKey: `trip:privacy-${STAMP}`, type: "trip", buyer: buyer.id, underReport: true, lastMessageAt: new Date().toISOString() }, overrideAccess: true, req });
  await payload.create({ collection: "push-subscriptions", data: { user: buyer.id, endpoint: `https://push.example/${STAMP}`, p256dh: "p".repeat(20), auth: "a".repeat(12) }, overrideAccess: true, req });

  // --- export ---
  const data = await exportUserData(ctx, buyer.id, admin.id);
  const json = JSON.stringify(data);
  check("export: account, orders, messages and files are included", data.account.email.startsWith("privacy-buyer") && data.orders[0]?.code === "DM-PPPP" && data.messagesYouSent.length === 1 && data.filesYouUploaded.length === 3);
  check("export: no password hash, salt, tokens or 2FA secrets", !/"hash"|"salt"|resetPasswordToken|_verificationToken|twoFactor|sessions/.test(json));
  const exportLog = await payload.find({ collection: "audit-logs", where: { and: [{ action: { equals: "privacy.exported" } }, { targetId: { equals: buyer.id } }] }, depth: 0, req });
  check("export is written in the audit log", exportLog.docs.length === 1);

  // --- refusals ---
  const active = await payload.create({ collection: "orders", data: { code: "DM-QQQQ", buyer: buyer.id, mode: "casual", status: "ready_to_book" }, overrideAccess: true, req });
  check("can't erase while an order is still in progress", (await refusedWith(eraseUser(ctx, buyer.id, admin.id))).includes("in progress"));
  await payload.update({ collection: "orders", id: active.id, data: { status: "delivered" }, overrideAccess: true, req });
  check("can't erase a store owner here", (await refusedWith(eraseUser(ctx, seller.id, admin.id))).includes("store owner"));
  check("can't erase a super-admin", (await refusedWith(eraseUser(ctx, admin.id, admin.id))).includes("Super-admin"));

  // --- erase ---
  const result = await eraseUser(ctx, buyer.id, admin.id);
  const after = (await payload.findByID({ collection: "users", id: buyer.id, depth: 0, showHiddenFields: true, req })) as User & { deletedAt?: string; sessions?: unknown[] };
  check("account anonymized (email, name, username, phone, address)", after.email.endsWith("@deleted.invalid") && after.name === "Deleted user" && !after.chatName && !after.phone && !after.buyerProfile?.addressDetails, { email: after.email, name: after.name });
  check("marked as erased, no sessions left", Boolean(after.deletedAt) && (after.sessions ?? []).length === 0);
  const files = await payload.find({ collection: "private-media", where: { owner: { equals: buyer.id } }, depth: 0, req });
  check("landmark + chat photo deleted; the payment receipt kept with the order", files.docs.length === 1 && files.docs[0]!.id === receipt, files.docs.map((f) => f.purpose));
  check("their normal chat is deleted", (await payload.find({ collection: "conversations", where: { id: { equals: chat.id } }, depth: 0, req })).docs.length === 0);
  check("a REPORTED chat is kept (dispute)", (await payload.find({ collection: "conversations", where: { id: { equals: reported.id } }, depth: 0, req })).docs.length === 1);
  check("push subscriptions removed", (await payload.find({ collection: "push-subscriptions", where: { user: { equals: buyer.id } }, depth: 0, req })).docs.length === 0);
  const keptOrder = await payload.findByID({ collection: "orders", id: order.id, depth: 0, req });
  check("orders are KEPT, but without name/address/pin/landmark/notes", keptOrder.code === "DM-PPPP" && keptOrder.delivery?.buyerName === "Deleted user" && !keptOrder.delivery?.addressDetails && !keptOrder.delivery?.landmarkPhoto && !keptOrder.riderNotes);
  check("result summary", result.chatsDeleted === 1 && result.chatsKeptUnderReport === 1 && result.ordersAnonymized === 2, result);
  const eraseLog = await payload.find({ collection: "audit-logs", where: { and: [{ action: { equals: "privacy.erased" } }, { targetId: { equals: buyer.id } }] }, depth: 0, req });
  check("erase is written in the audit log", eraseLog.docs.length === 1);
  check("can't erase twice", (await refusedWith(eraseUser(ctx, buyer.id, admin.id))).includes("already"));
  const beforeLogin = payload.collections.users.config.hooks.beforeLogin![0]!;
  check("an erased account can't log in", await Promise.resolve().then(() => beforeLogin({ user: after, context: {} } as never)).then(() => false, () => true));
} catch (error) {
  check("unexpected error", false, (error as Error).stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  await killTransaction(req);
}

const leftovers = await payload.find({ collection: "users", where: { email: { like: "privacy-" } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))));
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
