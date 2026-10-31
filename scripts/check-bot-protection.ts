// Run: bun run test:bot-protection
// Phase 2f: client IP, Cloudflare Turnstile check (uses Cloudflare's official test keys, needs
// internet) and rate limits (real dev database, inside a transaction that is cancelled, so no
// counters are saved).
import type { MongooseAdapter } from "@payloadcms/db-mongodb";
import { getPayload } from "payload";

import config from "../src/payload.config";
import { clientIp } from "../src/modules/bot-protection/server/client-ip";
import { hitRateLimit } from "../src/modules/bot-protection/server/rate-limit";
import { verifyTurnstile } from "../src/modules/bot-protection/server/turnstile";

// Cloudflare test secrets: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const ALWAYS_PASS = "1x0000000000000000000000000000000AA";
const ALWAYS_FAIL = "2x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};

console.log("--- Client IP ---");
check("x-real-ip wins", clientIp(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
check("first x-forwarded-for entry", clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
check("no headers -> unknown", clientIp(new Headers()), "unknown");

console.log("--- Turnstile (talks to Cloudflare with test keys) ---");
const realSecret = process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_SECRET_KEY;
check("no secret configured -> refused", await verifyTurnstile(DUMMY_TOKEN, "unknown"), false);
process.env.TURNSTILE_SECRET_KEY = ALWAYS_PASS;
check("empty token -> refused", await verifyTurnstile("", "unknown"), false);
check("valid token -> accepted", await verifyTurnstile(DUMMY_TOKEN, "unknown"), true);
process.env.TURNSTILE_SECRET_KEY = ALWAYS_FAIL;
check("Cloudflare says no -> refused", await verifyTurnstile(DUMMY_TOKEN, "unknown"), false);
process.env.TURNSTILE_SECRET_KEY = realSecret;

console.log("--- Rate limits (dev DB, cancelled transaction) ---");
const payload = await getPayload({ config });
const session = await (payload.db as MongooseAdapter).connection.getClient().startSession();
session.startTransaction();
try {
  const rule = { name: `test-${Date.now()}`, max: 3, windowMinutes: 15 };
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await hitRateLimit(payload, rule, "203.0.113.7", session)).ok);
  check("3 tries allowed, the 4th is blocked", results, [true, true, true, false]);
  check("another IP has its own counter", (await hitRateLimit(payload, rule, "203.0.113.8", session)).ok, true);
  check(
    "emails count the same in any letter case",
    [
      (await hitRateLimit(payload, { ...rule, max: 1 }, "Someone@Example.com", session)).ok,
      (await hitRateLimit(payload, { ...rule, max: 1 }, "someone@example.com", session)).ok,
    ],
    [true, false],
  );
  const blocked = await hitRateLimit(payload, rule, "203.0.113.7", session);
  check("says how long to wait (1-15 min)", blocked.retryAfterMinutes >= 1 && blocked.retryAfterMinutes <= 15, true);

  const stored = await (payload.db as MongooseAdapter).connection
    .db!.collection("rate_limits")
    .findOne({ _id: { $regex: `^${rule.name}:` } } as never, { session });
  check("IP is stored hashed, not as plain text", JSON.stringify(stored).includes("203.0.113"), false);
} finally {
  await session.abortTransaction();
  await session.endSession();
}

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
