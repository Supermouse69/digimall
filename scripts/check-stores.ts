// Run: bun run test:stores
// Phase 3a store + product rules, end to end on the real dev database, inside transactions that
// are cancelled, so nothing is saved:
// - buyers only see approved stores and non-hidden products, never a store's private fields
// - sellers can't change status / QR approval; a new GCash QR needs approval again
// - prices are whole pesos; status, QR approval and product hiding are audit-logged
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { Tenant, User } from "../src/payload-types";

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

type Ctx = { req: PayloadRequest; seller: User; admin: User; store: Tenant; categoryId: string };

const scenario = async (name: string, run: (ctx: Ctx) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  try {
    const store = (await payload.create({
      collection: "tenants",
      data: { name: `Store Test ${STAMP}`, slug: `store-test-${STAMP}`, status: "pending" },
      req,
    })) as Tenant;
    const seller = (await payload.create({
      collection: "users",
      data: {
        email: `store-test-seller-${STAMP}@example.invalid`,
        name: "Test Seller",
        role: "seller",
        password: `pw-${STAMP}-seller-long`,
        _verified: true,
        tenants: [{ tenant: store.id }],
      },
      disableVerificationEmail: true,
      req,
    })) as User;
    const admin = (await payload.create({
      collection: "users",
      data: { email: `store-test-admin-${STAMP}@example.invalid`, name: "Test Admin", role: "super-admin", password: `pw-${STAMP}-admin-long`, _verified: true },
      disableVerificationEmail: true,
      req,
    })) as User;
    const category = await payload.create({
      collection: "categories",
      data: { name: `Test Category ${STAMP}`, slug: `test-category-${STAMP}` },
      req,
    });
    await run({
      req,
      seller: { ...seller, collection: "users" } as User,
      admin: { ...admin, collection: "users" } as User,
      store,
      categoryId: category.id,
    });
  } catch (error) {
    check(`${name}: unexpected error`, false, (error as Error).message);
  } finally {
    await killTransaction(req);
  }
};

// A private-media record (database-level insert: no real file needed to test the rules)
const fakeFile = (req: PayloadRequest, owner: User, purpose: string) =>
  payload.db.create({
    collection: "private-media",
    data: { owner: owner.id, purpose, filename: `${owner.id}-${purpose}-${STAMP}-${Math.random().toString(36).slice(2)}.webp`, mimeType: "image/webp" },
    req,
  }) as Promise<{ id: string }>;

const storeAs = (req: PayloadRequest, user: User, id: string, data: Record<string, unknown>) =>
  payload.update({ collection: "tenants", id, data, user, overrideAccess: false, req }).then(
    () => "saved",
    (error: Error) => error.message,
  );
const storeNow = (req: PayloadRequest, id: string) =>
  payload.findByID({ collection: "tenants", id, depth: 0, req }) as Promise<Tenant>;
// As a logged-out visitor. (Payload keeps the last `user` on a shared request, so clear it first.)
const asVisitor = (req: PayloadRequest) => {
  req.user = null;
  return req;
};
const publicStores = (req: PayloadRequest, slug: string) =>
  payload.find({ collection: "tenants", where: { slug: { equals: slug } }, overrideAccess: false, depth: 0, req: asVisitor(req) });
const auditCount = async (req: PayloadRequest, action: string, targetId: string) =>
  (await payload.find({ collection: "audit-logs", where: { and: [{ action: { equals: action } }, { targetId: { equals: targetId } }] }, depth: 0, req })).docs.length;

// Note: product rules that look at the STORE's status (tenant.status) can't be tested inside a
// transaction (Payload looks the stores up outside it), so they're checked read-only on the real
// data at the end instead.
await scenario("visibility", async ({ req, admin, store, categoryId }) => {
  check("pending store: buyers can't find it", (await publicStores(req, store.slug)).docs.length === 0);

  await payload.update({ collection: "tenants", id: store.id, data: { status: "unverified", phone: "09171234567" }, user: admin, req });
  const found = (await publicStores(req, store.slug)).docs[0] as Record<string, unknown> | undefined;
  check("unverified store: buyers can see it", Boolean(found));
  check("...but not its phone", found !== undefined && !("phone" in found), found && Object.keys(found));
  check("...or its GCash QR approval", found !== undefined && !("gcashQrApproved" in found));

  const product = await payload.create({ collection: "products", data: { name: "Soap", price: 25, tenant: store.id, category: categoryId }, req });
  await payload.update({ collection: "products", id: product.id, data: { isHidden: true, hiddenReason: "test" }, user: admin, req });
  check("hiding a product is logged", (await auditCount(req, "product.visibility_changed", product.id)) === 1);

  await payload.update({ collection: "tenants", id: store.id, data: { status: "suspended" }, user: admin, req });
  check("suspended store: hidden again", (await publicStores(req, store.slug)).docs.length === 0);
  check("status changes are logged", (await auditCount(req, "store.status_changed", store.id)) === 2);
});

await scenario("seller limits", async ({ req, seller, store }) => {
  const result = await storeAs(req, seller, store.id, { status: "verified", gcashQrApproved: true, description: "Fresh bread daily" });
  const after = await storeNow(req, store.id);
  check("seller saves own store details", result === "saved" && after.description === "Fresh bread daily", result);
  check("...but can't make it verified", after.status === "pending", after.status);
  check("...or approve their own GCash QR", after.gcashQrApproved !== true, after.gcashQrApproved);
  check("seller still sees own pending store (for editing)", (await payload.find({ collection: "tenants", where: { id: { equals: store.id } }, user: seller, overrideAccess: false, depth: 0, req })).docs.length === 1);
});

await scenario("GCash QR re-approval", async ({ req, seller, admin, store }) => {
  const qr1 = await fakeFile(req, seller, "store-gcash-qr");
  check("seller attaches own GCash QR", (await storeAs(req, seller, store.id, { gcashQr: qr1.id })) === "saved");
  await payload.update({ collection: "tenants", id: store.id, data: { gcashQrApproved: true }, user: admin, req });
  check("admin approves it", (await storeNow(req, store.id)).gcashQrApproved === true);

  const qr2 = await fakeFile(req, seller, "store-gcash-qr");
  check("seller swaps the QR", (await storeAs(req, seller, store.id, { gcashQr: qr2.id })) === "saved");
  check("...approval turns off by itself", (await storeNow(req, store.id)).gcashQrApproved === false);
  check("approval changes are logged", (await auditCount(req, "store.gcash_qr_approval_changed", store.id)) === 2);

  const wrongPurpose = await fakeFile(req, seller, "store-permit");
  check("a file uploaded for another purpose is refused as the QR", (await storeAs(req, seller, store.id, { gcashQr: wrongPurpose.id })) !== "saved");
  const someoneElses = await fakeFile(req, admin, "store-gcash-qr");
  check("someone else's file is refused", (await storeAs(req, seller, store.id, { gcashQr: someoneElses.id })) !== "saved");
});

await scenario("verified", async ({ req, admin, store }) => {
  await payload.update({ collection: "tenants", id: store.id, data: { status: "verified" }, user: admin, req });
  const after = await storeNow(req, store.id);
  check("verifying records who and when", Boolean(after.verifiedAt) && String(after.verifiedBy) === admin.id, { at: after.verifiedAt, by: after.verifiedBy });
});

await scenario("prices", async ({ req, store, categoryId }) => {
  const tryPrice = (price: number) =>
    payload.create({ collection: "products", data: { name: `P ${price}`, price, tenant: store.id, category: categoryId }, req }).then(
      () => "saved",
      () => "refused",
    );
  check("whole-peso price ₱25 is accepted", (await tryPrice(25)) === "saved");
  check("₱24.50 is refused", (await tryPrice(24.5)) === "refused");
  check("₱0 is refused", (await tryPrice(0)) === "refused");
});

await scenario("store fields", async ({ req, seller, store }) => {
  check("barangay outside the service area is refused", (await storeAs(req, seller, store.id, { barangay: "Makati" })) !== "saved");
  check("map pin in Manila is refused", (await storeAs(req, seller, store.id, { location: [120.9842, 14.5995] })) !== "saved");
  check("bad phone number is refused", (await storeAs(req, seller, store.id, { phone: "12345" })) !== "saved");
});

// Read-only checks on the real data (nothing is written)
{
  const stores = await payload.find({ collection: "tenants", depth: 0, pagination: false });
  const publicIds = new Set(stores.docs.filter((t) => t.status === "unverified" || t.status === "verified").map((t) => t.id));
  const visible = await payload.find({ collection: "products", depth: 1, pagination: false, overrideAccess: false });
  const tenantId = (t: unknown) => (typeof t === "string" ? t : (t as { id?: string } | null)?.id);
  check("real data: every public product is from an approved store", visible.docs.every((p) => publicIds.has(tenantId(p.tenant)!)));
  check("real data: no public product is hidden by the admin", visible.docs.every((p) => !p.isHidden));
  check(
    "real data: the store inside public products has no private fields",
    visible.docs.every((p) => {
      const t = p.tenant as Record<string, unknown> | string;
      return typeof t === "string" || !["phone", "gcashQr", "gcashQrApproved", "businessPermit", "birCertificate", "dtiSecRegistration", "verifiedBy"].some((k) => k in t);
    }),
  );
}

const leftovers = await payload.find({ collection: "tenants", where: { slug: { equals: `store-test-${STAMP}` } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.length === 0, leftovers.docs.length);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
