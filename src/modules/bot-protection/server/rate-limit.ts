import { createHash, createHmac } from "crypto";
import type { MongooseAdapter } from "@payloadcms/db-mongodb";
import type { ClientSession } from "mongodb";
import { APIError, type Payload } from "payload";

// Rate limits (CLAUDE.md §10.6, suggestions/bot protection and rate limits.txt).
// Counters live in MongoDB (in-memory counters don't work on Vercel, where every request can be
// a fresh server). Old counters delete themselves (TTL index). IPs and emails are stored only as
// keyed hashes, never as plain text.
//
// Kept in one module so we can switch to Upstash Redis later without touching the forms.

export type RateLimitRule = { name: string; max: number; windowMinutes: number };

export const RATE_LIMITS = {
  login: { name: "login", max: 10, windowMinutes: 15 },
  signup: { name: "signup", max: 5, windowMinutes: 60 },
  forgotPasswordIp: { name: "forgot-ip", max: 5, windowMinutes: 60 },
  forgotPasswordEmail: { name: "forgot-email", max: 3, windowMinutes: 60 },
  resendVerificationIp: { name: "resend-ip", max: 5, windowMinutes: 60 },
  adminLogin: { name: "admin-login", max: 5, windowMinutes: 15 },
  report: { name: "report", max: 5, windowMinutes: 60 },
  chatSend: { name: "chat-send", max: 30, windowMinutes: 1 },
  checkout: { name: "checkout", max: 5, windowMinutes: 10 },
  orderAction: { name: "order-action", max: 30, windowMinutes: 1 },
} satisfies Record<string, RateLimitRule>;

const COLLECTION = "rate_limits";

type Counter = { _id: string; count: number; expiresAt: Date };

const hashKey = (() => {
  let key: Buffer | null = null;
  return (value: string) => {
    if (!key) {
      const secret = process.env.PAYLOAD_SECRET;
      if (!secret) throw new Error("PAYLOAD_SECRET is missing");
      key = createHash("sha256").update(`digimall:rate-limit:${secret}`).digest();
    }
    return createHmac("sha256", key).update(value.trim().toLowerCase()).digest("base64url");
  };
})();

let indexReady: Promise<unknown> | null = null;

export type RateLimitResult = { ok: boolean; count: number; retryAfterMinutes: number };

// Counts one attempt for `rule` + `key` (an IP or an email) in the current time window.
// A fixed window: simple and good enough for beta traffic.
// `session` is only for tests (so their counters disappear when the test transaction is cancelled).
export const hitRateLimit = async (
  payload: Payload,
  rule: RateLimitRule,
  key: string,
  session?: ClientSession,
): Promise<RateLimitResult> => {
  const collection = (payload.db as MongooseAdapter).connection.db!.collection<Counter>(COLLECTION);
  indexReady ??= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => {
    indexReady = null;
    throw error;
  });
  await indexReady;

  const windowMs = rule.windowMinutes * 60_000;
  const windowNumber = Math.floor(Date.now() / windowMs);
  const expiresAt = new Date((windowNumber + 1) * windowMs);
  const _id = `${rule.name}:${hashKey(key)}:${windowNumber}`;

  const increment = () =>
    collection.findOneAndUpdate(
      { _id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after", session },
    );

  let counter: Counter | null;
  try {
    counter = await increment();
  } catch (error) {
    // Two requests creating the same counter at the same moment: the second one just retries
    if ((error as { code?: number }).code !== 11000) throw error;
    counter = await increment();
  }

  const count = counter?.count ?? 1;
  return {
    ok: count <= rule.max,
    count,
    retryAfterMinutes: Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000)),
  };
};

export const tooManyTriesMessage = (minutes: number) =>
  `Too many tries. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;

// For Payload hooks (REST API): same limits, Payload-style error
export const enforceApiRateLimit = async (payload: Payload, rule: RateLimitRule, key: string) => {
  const result = await hitRateLimit(payload, rule, key);
  if (!result.ok) throw new APIError(tooManyTriesMessage(result.retryAfterMinutes), 429, undefined, true);
};
