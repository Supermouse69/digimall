// Run: bun run test:rider-docs
// Riders may only attach private files THEY uploaded (right purpose), can't approve themselves,
// and replacing a document after approval sends them back to "pending".
// Real dev database, inside transactions that are cancelled — nothing is saved.
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";
import type { User } from "../src/payload-types";

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

// Each scenario runs in its own transaction (a refused update cancels the transaction it ran in)
const scenario = async (name: string, run: (req: PayloadRequest, users: { a: User; b: User }) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  try {
    const makeRider = async (tag: string) => {
      const user = await payload.create({
        collection: "users",
        data: {
          email: `rider-doc-${tag}-${STAMP}@example.invalid`,
          name: `Rider ${tag}`,
          role: "rider",
          password: `pw-${STAMP}-${tag}-long`,
          _verified: true,
        },
        disableVerificationEmail: true,
        req,
      });
      await payload.create({ collection: "rider-profiles", data: { user: user.id, displayName: `Rider ${tag}`, status: "pending" }, req });
      return user as User;
    };
    await run(req, { a: await makeRider("a"), b: await makeRider("b") });
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

const profileOf = async (req: PayloadRequest, user: User) =>
  (await payload.find({ collection: "rider-profiles", where: { user: { equals: user.id } }, depth: 0, req })).docs[0]!;

// Update as the rider (overrideAccess: false), the way the rider portal does it
const updateAs = (req: PayloadRequest, user: User, id: string, data: Record<string, unknown>) =>
  payload
    .update({ collection: "rider-profiles", id, data, user, overrideAccess: false, req })
    .then(() => "saved", (error: Error) => error.message);

await scenario("own file", async (req, { a }) => {
  const file = await fakeFile(req, a, "rider-license");
  const result = await updateAs(req, a, (await profileOf(req, a)).id, { licenseDocument: file.id });
  check("rider attaches their OWN license", result === "saved", result);
});

await scenario("someone else's file", async (req, { a, b }) => {
  const stolen = await fakeFile(req, a, "rider-license");
  const result = await updateAs(req, b, (await profileOf(req, b)).id, { licenseDocument: stolen.id });
  check("rider attaches ANOTHER rider's license -> refused", result !== "saved", result);
});

await scenario("wrong purpose", async (req, { a }) => {
  const landmark = await fakeFile(req, a, "landmark");
  const result = await updateAs(req, a, (await profileOf(req, a)).id, { licenseDocument: landmark.id });
  check("rider uses a landmark photo as their license -> refused", result !== "saved", result);
});

await scenario("other profile", async (req, { a, b }) => {
  const file = await fakeFile(req, a, "rider-license");
  const result = await updateAs(req, a, (await profileOf(req, b)).id, { licenseDocument: file.id });
  check("rider edits ANOTHER rider's profile -> refused", result !== "saved", result);
});

await scenario("self-approve", async (req, { a }) => {
  const profile = await profileOf(req, a);
  await updateAs(req, a, profile.id, { status: "approved" });
  const after = await payload.findByID({ collection: "rider-profiles", id: profile.id, depth: 0, req });
  check("rider sets their own status to approved -> ignored", after.status === "pending", after.status);
});

await scenario("re-check after approval", async (req, { a }) => {
  const profile = await profileOf(req, a);
  const first = await fakeFile(req, a, "rider-license");
  // The rider uploads their license, then the super-admin approves
  await updateAs(req, a, profile.id, { licenseDocument: first.id });
  const superAdmin = (await payload.create({
    collection: "users",
    data: { email: `rider-doc-admin-${STAMP}@example.invalid`, name: "Test Admin", role: "super-admin", password: `pw-${STAMP}-admin-long`, _verified: true },
    disableVerificationEmail: true,
    req,
  })) as User;
  const superAdminUser = { ...superAdmin, collection: "users" } as User;
  await payload.update({ collection: "rider-profiles", id: profile.id, data: { status: "approved" }, user: superAdminUser, req });
  const replacement = await fakeFile(req, a, "rider-license");
  const result = await updateAs(req, a, profile.id, { licenseDocument: replacement.id });
  const after = await payload.findByID({ collection: "rider-profiles", id: profile.id, depth: 0, req });
  check("approved rider replaces license -> saved", result === "saved", result);
  check("...and goes back to pending for a re-check", after.status === "pending", after.status);
  const logs = await payload.find({
    collection: "audit-logs",
    where: { and: [{ action: { equals: "rider.status_changed" } }, { targetId: { equals: profile.id } }] },
    depth: 0,
    req,
  });
  check("...and both status changes are in the audit log", logs.docs.length === 2, logs.docs.length);
});

const leftovers = await payload.find({
  collection: "users",
  where: { email: { like: `rider-doc-` } },
  depth: 0,
});
check("cleanup: nothing was saved", leftovers.docs.length === 0, leftovers.docs.length);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
