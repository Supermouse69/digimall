import { timingSafeEqual } from "crypto";
import { getPayload } from "payload";
import config from "@payload-config";

import { purgeExpiredChats } from "@/modules/chat/server/chat-service";

// Daily chat cleanup (CLAUDE.md §11.3, §10.11). Called by a scheduler (Vercel Cron at deploy)
// with "Authorization: Bearer <CRON_SECRET>". Without the right secret it does nothing.
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
  const result = await purgeExpiredChats({ payload });
  payload.logger.info(`chat cleanup: deleted ${result.conversations} chat(s), ${result.messages} message(s)`);
  return Response.json({ ok: true, ...result });
};
