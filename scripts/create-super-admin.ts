// PRODUCTION SETUP (run once on your own PC): creates the first super-admin account.
//   bun run prod:create-admin -- you@example.com "Your Name"
// Uses .env.production (the PRODUCTION database). Writes to that database.
// The password is random and shown ONCE here. Then log in ONLY through the hidden admin entry
// (/admin-entry/<ADMIN_ENTRY_PATH>), set up the authenticator app, and save your backup codes.
import { randomBytes } from "crypto";
import { getPayload } from "payload";

import config from "../src/payload.config";

const [email, ...nameParts] = process.argv.slice(2).filter((arg) => arg !== "--");
const name = nameParts.join(" ").trim() || "DigiMall Admin";

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.log('Usage: bun run prod:create-admin -- you@example.com "Your Name"');
  process.exit(1);
}

const payload = await getPayload({ config });
const existing = await payload.find({ collection: "users", where: { email: { equals: email.toLowerCase() } }, limit: 1, depth: 0, overrideAccess: true });
if (existing.docs.length > 0) {
  console.log(`An account with ${email} already exists. Nothing changed.`);
  process.exit(1);
}

const password = randomBytes(18).toString("base64url");
await payload.create({
  collection: "users",
  data: { email, name, role: "super-admin", password, _verified: true } as never,
  disableVerificationEmail: true,
  overrideAccess: true,
});
console.log("\nSuper-admin created.");
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}   <- shown only now; store it in a password manager`);
console.log("  Log in at /admin-entry/<ADMIN_ENTRY_PATH> and set up the authenticator app.\n");
process.exit(0);
