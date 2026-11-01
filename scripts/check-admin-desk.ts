// Run: bun run test:admin-desk
// Phase 8 Admin desk: every queue counts the right things and links to the right filtered list.
// Real dev database inside a transaction that is cancelled (nothing is saved).
import { getPayload, killTransaction } from "payload";

import config from "../src/payload.config";
import { AdminDesk } from "../src/components/admin/admin-desk";
import { adminQueues } from "../src/modules/admin-desk/server/queues";
import { startTransaction } from "../src/lib/transaction";

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};

const payload = await getPayload({ config });
await Promise.all(
  Object.values(payload.db.collections).map((model) => (model as { init: () => Promise<unknown> }).init()),
);
const STAMP = Date.now();
const req = await startTransaction(payload);
const ctx = { payload, req };

try {
  const before = Object.fromEntries((await adminQueues(ctx)).map((q) => [q.key, q.count]));

  const user = async (tag: string, role: string) =>
    (await payload.create({ collection: "users", data: { email: `desk-${tag}-${STAMP}@example.invalid`, password: `pw-${STAMP}-${tag}-long`, name: tag, role, _verified: true } as never, disableVerificationEmail: true, req })).id;
  const sellerId = await user("seller", "seller");
  const buyerId = await user("buyer", "buyer");
  const riderId = await user("rider", "rider");

  await payload.create({ collection: "tenants", data: { name: "Desk pending", slug: `desk-pending-${STAMP}`, status: "pending" }, req });
  const live = await payload.create({ collection: "tenants", data: { name: "Desk live", slug: `desk-live-${STAMP}`, status: "unverified" }, req });
  const qr = (await payload.db.create({ collection: "private-media", data: { owner: sellerId, purpose: "store-gcash-qr", filename: `desk-${STAMP}.webp`, mimeType: "image/webp" }, req })) as { id: string };
  await payload.db.updateOne({ collection: "tenants", id: live.id, data: { gcashQr: qr.id, gcashQrApproved: false }, req });
  await payload.create({ collection: "rider-profiles", data: { user: riderId, displayName: "Desk rider", status: "pending" }, req });
  await payload.create({ collection: "reports", data: { targetType: "store", store: live.id, reason: "scam", reporter: buyerId, status: "open" }, overrideAccess: true, req });

  const order = await payload.create({ collection: "orders", data: { code: "DM-ZZZZ", buyer: buyerId, mode: "casual", status: "in_progress" }, overrideAccess: true, req });
  const so = (status: string, extra: Record<string, unknown>, suffix: string) =>
    payload.db.create({
      collection: "store-orders",
      data: { code: `DM-ZZZZ-${suffix}`, order: order.id, suffix, tenant: live.id, buyer: buyerId, items: [], subtotal: 10, status, ...extra },
      req,
    });
  const longAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
  await so("cancelled", { refund: { status: "escalated", amount: 10 } }, "A");
  await so("payment_submitted", { payment: { submittedAt: longAgo, notReceivedAt: longAgo } }, "B");
  await so("payment_submitted", { payment: { submittedAt: longAgo } }, "C");
  await so("cancelled", { refund: { status: "awaiting_buyer_qr", amount: 10, adminFlaggedAt: longAgo } }, "D");

  const after = Object.fromEntries((await adminQueues(ctx)).map((q) => [q.key, q]));
  const grew = (key: string, by = 1) => after[key]!.count - (before[key] ?? 0) === by;
  check("pending store counted", grew("stores-pending"));
  check("GCash QR waiting for approval counted", grew("qr-pending"));
  check("pending rider counted", grew("riders-pending"));
  check("open report counted", grew("reports-open"));
  check("escalated refund counted", grew("refunds-escalated"));
  check("'payment not received' dispute counted", grew("payment-not-received"));
  check("unchecked payments counted (both receipts older than the limit)", grew("payment-unchecked", 2), { before: before["payment-unchecked"], after: after["payment-unchecked"]!.count });
  check("refund with a missing buyer QR (flagged) counted", grew("refunds-no-qr"));
  check("open store without closing time counted", grew("stores-no-hours"));
  check("open store without a map pin counted", grew("stores-no-pin"));
  check("links open the filtered admin list", after["stores-pending"]!.href === "/admin/collections/tenants?where[status][equals]=pending", after["stores-pending"]!.href);
  check("nested filters are encoded (refund.status)", after["refunds-escalated"]!.href.includes("where[refund.status][equals]=escalated"), after["refunds-escalated"]!.href);

  check("sellers see no Admin desk", (await AdminDesk({ payload, user: { role: "seller" } })) === null);
  check("the super-admin sees the Admin desk", (await AdminDesk({ payload, user: { role: "super-admin" } })) !== null);
} catch (error) {
  check("unexpected error", false, (error as Error).stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  await killTransaction(req);
}

const leftovers = await payload.find({ collection: "users", where: { email: { like: "desk-" } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.every((u) => !u.email.includes(String(STAMP))));
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
