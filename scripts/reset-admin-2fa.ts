// EMERGENCY ONLY — run on your own PC (needs the database password in .env).
// Use when a super-admin lost their phone AND their backup codes, or got locked out.
//
//   bun run admin:reset-2fa you@example.com                    -> turns 2-step login off; you set it up
//                                                                 again at your next hidden-entry login
//   bun run admin:reset-2fa you@example.com --new-password     -> also sets a new random password
//                                                                 (printed once here)
//
// Writes to the database and is recorded in the audit log.
import { randomBytes } from "crypto";
import { getPayload } from "payload";

import config from "../src/payload.config";

const [email, flag] = process.argv.slice(2);
if (!email || (flag && flag !== "--new-password")) {
  console.log("Usage: bun run admin:reset-2fa <email> [--new-password]");
  process.exit(1);
}

const payload = await getPayload({ config });
const { docs } = await payload.find({
  collection: "users",
  where: { email: { equals: email.trim().toLowerCase() } },
  limit: 1,
  depth: 0,
  overrideAccess: true,
});
const user = docs[0];
if (!user || user.role !== "super-admin") {
  console.log("No super-admin account with that email.");
  process.exit(1);
}

const newPassword = flag === "--new-password" ? randomBytes(18).toString("base64url") : undefined;

await payload.update({
  collection: "users",
  id: user.id,
  overrideAccess: true,
  data: {
    twoFactor: { enabled: false, secret: null, pendingSecret: null, backupCodeHashes: [], failedAttempts: 0, lockedUntil: null },
    loginAttempts: 0,
    lockUntil: null,
    ...(newPassword ? { password: newPassword } : {}),
  } as never,
});
await payload.create({
  collection: "audit-logs",
  overrideAccess: true,
  data: {
    action: "admin.2fa_reset",
    actor: user.id,
    targetCollection: "users",
    targetId: user.id,
    details: { via: "local script", newPassword: Boolean(newPassword) },
  },
});

console.log(`2-step login turned OFF for ${user.email}. Log in at /admin-entry/<ADMIN_ENTRY_PATH> to set it up again.`);
if (newPassword) console.log(`New password (shown once — change it after logging in): ${newPassword}`);
process.exit(0);
