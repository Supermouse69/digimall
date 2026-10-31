// Run: bun run test:invites
// End-to-end test of the invite flow against the real dev database, inside ONE transaction
// that is cancelled at the end — so nothing is saved. (Invite emails print to the console.)
import { createLocalReq, getPayload, initTransaction, killTransaction } from "payload";

import config from "../src/payload.config";

const STAMP = Date.now();
const SELLER_EMAIL = `invite-test-seller-${STAMP}@example.invalid`;
const RIDER_EMAIL = `invite-test-rider-${STAMP}@example.invalid`;

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};

const payload = await getPayload({ config });
// Wait until every collection + index exists: MongoDB can't create them inside a transaction
await Promise.all(
  Object.values(payload.db.collections).map((model) => (model as { init: () => Promise<unknown> }).init()),
);
const req = await createLocalReq({}, payload);
await initTransaction(req);

try {
  const store = await payload.create({
    collection: "tenants",
    data: { name: "Invite Test Store", slug: `invite-test-${STAMP}`, status: "pending" },
    req,
  });

  // --- Seller invite ---
  const sellerInvite = await payload.create({
    collection: "invites",
    data: { email: SELLER_EMAIL.toUpperCase(), name: "Test Seller", role: "seller", store: store.id },
    req,
  });
  const sellers = await payload.find({
    collection: "users",
    where: { email: { equals: SELLER_EMAIL } },
    showHiddenFields: true,
    depth: 0,
    req,
  });
  const seller = sellers.docs[0] as (typeof sellers.docs)[number] & { _verified?: boolean; resetPasswordToken?: string };
  check("seller invite: email saved in lowercase", sellerInvite.email === SELLER_EMAIL, sellerInvite.email);
  check("seller invite: account created", Boolean(seller));
  check("seller invite: role is seller", seller?.role === "seller", seller?.role);
  check("seller invite: linked to the store", seller?.tenants?.[0]?.tenant === store.id, seller?.tenants);
  check("seller invite: email counts as confirmed", seller?._verified === true, seller?._verified);
  check("seller invite: set-password link created", Boolean(seller?.resetPasswordToken));
  const savedSellerInvite = await payload.findByID({ collection: "invites", id: sellerInvite.id, depth: 0, req });
  check("seller invite: status 'sent'", savedSellerInvite.status === "sent", savedSellerInvite.status);
  check("seller invite: points to the new user", savedSellerInvite.user === seller?.id);

  // --- Send again ---
  const firstToken = seller?.resetPasswordToken;
  await payload.update({ collection: "invites", id: sellerInvite.id, data: { resend: true }, req });
  const resent = await payload.findByID({ collection: "invites", id: sellerInvite.id, depth: 0, req });
  const sellerAfter = (await payload.findByID({ collection: "users", id: seller!.id, showHiddenFields: true, depth: 0, req })) as typeof seller;
  check("send again: box unticks itself", resent.resend === false, resent.resend);
  check("send again: new link (old one stops working)", Boolean(sellerAfter?.resetPasswordToken) && sellerAfter?.resetPasswordToken !== firstToken);

  // --- Rider invite ---
  await payload.create({
    collection: "invites",
    data: { email: RIDER_EMAIL, name: "Test Rider", role: "rider" },
    req,
  });
  const rider = (await payload.find({ collection: "users", where: { email: { equals: RIDER_EMAIL } }, depth: 0, req })).docs[0];
  const profiles = await payload.find({ collection: "rider-profiles", where: { user: { equals: rider?.id } }, depth: 0, req });
  check("rider invite: account created with role rider", rider?.role === "rider", rider?.role);
  check("rider invite: no store attached", (rider?.tenants ?? []).length === 0);
  check("rider invite: rider profile created", profiles.docs.length === 1);
  check("rider invite: profile starts as pending", profiles.docs[0]?.status === "pending", profiles.docs[0]?.status);

  const logs = await payload.find({
    collection: "audit-logs",
    where: { action: { equals: "invite.sent" } },
    sort: "-createdAt",
    limit: 3,
    depth: 0,
    req,
  });
  check("audit log: invites recorded (2 invites + 1 resend)", logs.docs.length >= 3, logs.docs.length);
} finally {
  // Cancel everything this test did
  await killTransaction(req);
}

// --- Rules that must REFUSE an invite ---
// A failed Payload operation cancels its transaction, so each check gets its own fresh one.
// That way a broken rule could never accidentally save a real account.
const expectRefused = async (label: string, data: Record<string, unknown>, setup?: (r: typeof req) => Promise<void>) => {
  const ruleReq = await createLocalReq({}, payload);
  await initTransaction(ruleReq);
  try {
    if (setup) await setup(ruleReq);
    const result = await payload
      .create({ collection: "invites", data: data as never, req: ruleReq })
      .then(() => "created", (error: Error) => error.message);
    check(label, result !== "created", result);
  } finally {
    await killTransaction(ruleReq);
  }
};

const dupEmail = `dup-${STAMP}@example.invalid`;
await expectRefused(
  "duplicate email is refused",
  { email: dupEmail, name: "Again", role: "rider" },
  async (ruleReq) => {
    await payload.create({ collection: "invites", data: { email: dupEmail, name: "First", role: "rider" }, req: ruleReq });
  },
);
await expectRefused("seller invite without a store is refused", {
  email: `no-store-${STAMP}@example.invalid`,
  name: "X",
  role: "seller",
});

const leftovers = await payload.find({
  collection: "users",
  where: { email: { in: [SELLER_EMAIL, RIDER_EMAIL, dupEmail, `no-store-${STAMP}@example.invalid`] } },
  depth: 0,
});
check("cleanup: nothing was saved (transaction cancelled)", leftovers.docs.length === 0, leftovers.docs.length);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
