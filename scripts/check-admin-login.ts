// Run: bun run test:admin-login
// Super-admins can't log in (or reset a password) the normal way; other roles still can.
// Real dev database, inside transactions that are cancelled — nothing is saved.
import { createLocalReq, getPayload, initTransaction, killTransaction, type PayloadRequest } from "payload";

import config from "../src/payload.config";

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
const PASSWORD = `pw-${STAMP}-long-enough`;

// Each check gets a fresh transaction with one test user (a refused login cancels its transaction)
const withUser = async (role: "super-admin" | "seller", run: (req: PayloadRequest, email: string) => Promise<void>) => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  const email = `admin-login-${role}-${STAMP}-${Math.random().toString(36).slice(2)}@example.invalid`;
  try {
    await payload.create({
      collection: "users",
      data: { email, name: `Test ${role}`, role, password: PASSWORD, _verified: true } as never,
      disableVerificationEmail: true,
      req,
    });
    await run(req, email);
  } finally {
    await killTransaction(req);
  }
};

const tryLogin = (req: PayloadRequest, email: string, adminEntry = false) =>
  payload
    .login({ collection: "users", data: { email, password: PASSWORD }, req, ...(adminEntry ? { context: { adminEntry: true } } : {}) })
    .then((result) => (result.token ? "logged in" : "no token"), (error: Error) => error.message);

await withUser("super-admin", async (req, email) => {
  const result = await tryLogin(req, email);
  check("super-admin, normal login (/login, /admin/login, REST) -> refused", result !== "logged in", result);
  check("...with the generic message", /incorrect/i.test(result), result);
});

await withUser("super-admin", async (req, email) => {
  const result = await tryLogin(req, email, true);
  check("super-admin through the hidden entry (after 2FA) -> allowed", result === "logged in", result);
});

await withUser("seller", async (req, email) => {
  const result = await tryLogin(req, email);
  check("seller, normal login -> still works", result === "logged in", result);
});

await withUser("super-admin", async (req, email) => {
  // Even if a reset link exists, using it must NOT log a super-admin in (that would skip 2FA)
  const token = await payload.forgotPassword({ collection: "users", data: { email }, disableEmail: true, req });
  const result = await payload
    .resetPassword({ collection: "users", data: { token: token!, password: "a-brand-new-password" }, overrideAccess: true, req })
    .then((r) => (r.token ? "logged in" : "no token"), (error: Error) => error.message);
  check("super-admin uses a reset link -> refused (no login, 2FA can't be skipped)", result !== "logged in", result);
});

await withUser("seller", async (req, email) => {
  const token = await payload.forgotPassword({ collection: "users", data: { email }, disableEmail: true, req });
  check("seller 'forgot password' -> reset link made", Boolean(token));
});

await withUser("super-admin", async (req, email) => {
  const me = (await payload.find({ collection: "users", where: { email: { equals: email } }, depth: 0, req })).docs[0]!;
  await payload.update({
    collection: "users",
    id: me.id,
    data: { twoFactor: { enabled: true, secret: "ENCRYPTED-SECRET", backupCodeHashes: ["HASH-1"] } } as never,
    req,
  });
  // How the admin's own account looks through the API (/api/users/me): access rules apply
  const viaApi = (await payload.findByID({
    collection: "users",
    id: me.id,
    depth: 0,
    overrideAccess: false,
    user: { ...me, collection: "users" },
    req,
  })) as unknown as Record<string, unknown>;
  check("2FA data is not in the account's own API response", !("twoFactor" in viaApi), Object.keys(viaApi));
  // Even a server-side read (no access rules) must not include the secret or backup codes
  const serverSide = JSON.stringify(await payload.findByID({ collection: "users", id: me.id, depth: 0, req }));
  check("secret + backup code hashes never in normal reads", !serverSide.includes("ENCRYPTED-SECRET") && !serverSide.includes("HASH-1"));
  const withHidden = JSON.stringify(await payload.findByID({ collection: "users", id: me.id, depth: 0, showHiddenFields: true, req }));
  check("...only server code that asks for hidden fields can read them", withHidden.includes("ENCRYPTED-SECRET"));
});

// Payload only keeps a session if the account is marked verified. An account with NO status can
// log in but is instantly treated as logged out (the bug fixed by migration 20261031_002034).
const stuck = await payload.db.collections["users"]!.collection.countDocuments({ _verified: { $exists: false } });
check("no account is stuck 'logged in but not kept logged in' (missing verified status)", stuck === 0, stuck);

const leftovers = await payload.find({ collection: "users", where: { email: { like: `admin-login-` } }, depth: 0 });
check("cleanup: nothing was saved", leftovers.docs.length === 0, leftovers.docs.length);

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
