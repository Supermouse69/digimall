import webpush from "web-push";
import type { Payload, PayloadRequest } from "payload";

// All notification sending lives here (CLAUDE.md §11.12), so a native rider app can be added
// later as one more target. Web Push (VAPID): Android works in the browser; iPhone needs the site
// added to the home screen. Sending never blocks or breaks the action that triggered it.

export type PushMessage = { title: string; body: string; url: string; tag?: string };

let configured: boolean | null = null;
const configure = () => {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || publicKey.startsWith("change-me")) {
    console.warn("Web push is off: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are missing.");
    configured = false;
    return false;
  }
  // VAPID "subject": who runs this push sender (an https URL is allowed)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const subject = appUrl.startsWith("https://") ? appUrl : "https://digimall.online";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
};

export const pushToUsers = async (
  { payload, req }: { payload: Payload; req?: PayloadRequest },
  userIds: string[],
  message: PushMessage,
) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0 || !configure()) return 0;
  try {
    const { docs } = await payload.find({
      collection: "push-subscriptions",
      where: { user: { in: ids } },
      depth: 0,
      limit: 50,
      overrideAccess: true,
      req,
    });
    // Only short, non-sensitive text goes to the phone's lock screen (no addresses, no amounts paid)
    const body = JSON.stringify({ title: message.title.slice(0, 80), body: message.body.slice(0, 140), url: message.url, tag: message.tag });
    let sent = 0;
    await Promise.all(
      docs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 600, timeout: 5000 });
          sent++;
        } catch (error) {
          // The browser unsubscribed or the subscription expired: forget it
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await payload.delete({ collection: "push-subscriptions", id: sub.id, overrideAccess: true, req }).catch(() => undefined);
          }
        }
      }),
    );
    return sent;
  } catch (error) {
    payload.logger.warn(`push failed: ${(error as Error).message}`);
    return 0;
  }
};

// Sellers of a store (who should hear about its new orders and chats)
export const sellerIdsOfStore = async ({ payload, req }: { payload: Payload; req?: PayloadRequest }, tenantId: string) => {
  const { docs } = await payload.find({
    collection: "users",
    where: { and: [{ role: { equals: "seller" } }, { "tenants.tenant": { equals: tenantId } }] },
    depth: 0,
    limit: 20,
    overrideAccess: true,
    req,
  });
  return docs.map((user) => user.id);
};
