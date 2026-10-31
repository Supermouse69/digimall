import z from "zod";
import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";
import type { Payload } from "payload";

import { clientIp } from "./client-ip";
import { hitRateLimit, tooManyTriesMessage, type RateLimitRule } from "./rate-limit";
import { verifyTurnstile } from "./turnstile";

// Added to the input of every procedure behind a public form
export const humanCheckInput = {
  turnstileToken: z.string().max(2048),
};

export const HUMAN_CHECK_FAILED = "Please finish the \"I'm not a robot\" check and try again.";

type Limit = { rule: RateLimitRule; key?: string };

// Rate limits first (they also count bots that send no token), then the Turnstile check.
// A limit without a key counts per IP address.
export const guardPublicForm = async (
  payload: Payload,
  { turnstileToken, limits }: { turnstileToken: string; limits: Limit[] },
) => {
  const ip = clientIp(await getHeaders());

  for (const { rule, key } of limits) {
    const result = await hitRateLimit(payload, rule, key ?? ip);
    if (!result.ok) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: tooManyTriesMessage(result.retryAfterMinutes) });
    }
  }

  if (!(await verifyTurnstile(turnstileToken, ip))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: HUMAN_CHECK_FAILED });
  }
};

// Rate limit only (for steps that come after a protected form, e.g. 2FA setup, or logged-in
// actions like reports). Counts per IP unless a key (e.g. the user's ID) is given.
export const guardRateLimit = async (payload: Payload, rule: RateLimitRule, key?: string) => {
  const result = await hitRateLimit(payload, rule, key ?? clientIp(await getHeaders()));
  if (!result.ok) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: tooManyTriesMessage(result.retryAfterMinutes) });
  }
};
