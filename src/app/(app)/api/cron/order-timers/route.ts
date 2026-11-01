import { timingSafeEqual } from "crypto";
import { getPayload } from "payload";
import config from "@payload-config";

import { runOrderTimers } from "@/modules/orders/server/order-service";
import { expireStaleRiderRequests } from "@/modules/trips/server/trip-service";

// Order timers + repeated reminders (CLAUDE.md §11.6, §11.9, §8 decided paid-but-unbooked rule).
// Timers also run whenever someone opens an order; THIS job is what sends the reminders and pushes
// on time. Call it often (e.g. every 15–60 min) with "Authorization: Bearer <CRON_SECRET>".
export const dynamic = "force-dynamic";

const authorized = (header: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export const GET = async (request: Request) => {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await getPayload({ config });
  const riderRequests = await expireStaleRiderRequests({ payload });
  const counts = await runOrderTimers({ payload });
  payload.logger.info(`order timers: ${JSON.stringify({ riderRequests, ...counts })}`);
  return Response.json({ ok: true, riderRequests, ...counts });
};
