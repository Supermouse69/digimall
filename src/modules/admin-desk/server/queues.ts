import type { Payload, PayloadRequest, Where } from "payload";

import { fromPoint } from "@/lib/geo";
import { getSettings } from "@/modules/settings/server/settings";

// The super-admin's to-do list (CLAUDE.md §14 Phase 8): counts of things waiting for them, each
// with a link to the matching filtered list in the Payload admin. Read-only.

export type QueueItem = {
  key: string;
  title: string;
  hint: string;
  count: number;
  href: string;
  tone: "urgent" | "todo" | "setup";
};

// Payload admin list URLs accept the same "where" as the API, as query-string brackets
const listUrl = (collection: string, where: Record<string, unknown>) => {
  const parts: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}[${encodeURIComponent(key)}]`);
    } else if (Array.isArray(value)) {
      value.forEach((inner, index) => walk(inner, `${path}[${index}]`));
    } else {
      parts.push(`${path}=${encodeURIComponent(String(value))}`);
    }
  };
  walk(where, "where");
  return `/admin/collections/${collection}?${parts.join("&")}`;
};

type Ctx = { payload: Payload; req?: PayloadRequest };

// (find + totalDocs instead of count: MongoDB can't run a plain count inside a transaction)
const count = async ({ payload, req }: Ctx, collection: Parameters<Payload["count"]>[0]["collection"], where: Where) =>
  (await payload.find({ collection, where, depth: 0, limit: 1, overrideAccess: true, req })).totalDocs;

export const adminQueues = async (ctx: Ctx, now = Date.now()): Promise<QueueItem[]> => {
  const settings = await getSettings(ctx.payload);
  const checkBefore = new Date(now - settings.paymentCheckReminderMinutes * 60_000).toISOString();

  const defs: (Omit<QueueItem, "count" | "href"> & { collection: Parameters<Payload["count"]>[0]["collection"]; where: Where })[] = [
    // --- urgent: money or safety ---
    { key: "refunds-escalated", tone: "urgent", title: "Late refunds (escalated)", hint: "The store didn't send a refund in time. Contact the store; suspend it if needed.", collection: "store-orders", where: { "refund.status": { equals: "escalated" } } },
    { key: "payment-not-received", tone: "urgent", title: "\"Payment not received\" disputes", hint: "The store says the buyer's GCash payment didn't arrive. Check the receipt in the chat (opening it is logged).", collection: "store-orders", where: { and: [{ status: { equals: "payment_submitted" } }, { "payment.notReceivedAt": { exists: true } }] } },
    { key: "reports-open", tone: "urgent", title: "Open reports", hint: "Buyer reports about products, stores or chats. Hide the product / suspend the store, then mark it resolved.", collection: "reports", where: { status: { equals: "open" } } },
    { key: "payment-unchecked", tone: "urgent", title: "Payments nobody checked", hint: `Receipt sent more than ${settings.paymentCheckReminderMinutes} min ago, store hasn't answered.`, collection: "store-orders", where: { and: [{ status: { equals: "payment_submitted" } }, { "payment.submittedAt": { less_than: checkBefore } }] } },
    { key: "refunds-no-qr", tone: "todo", title: "Refunds waiting for the buyer's QR (flagged)", hint: `The buyer hasn't sent their GCash QR for ${settings.refundQrFlagDays}+ days. Remind them in a report/chat if needed.`, collection: "store-orders", where: { and: [{ "refund.status": { equals: "awaiting_buyer_qr" } }, { "refund.adminFlaggedAt": { exists: true } }] } },
    // --- approvals ---
    { key: "stores-pending", tone: "todo", title: "Stores waiting for approval", hint: "Set to \"Unverified store\", or \"Business permit checked\" after you saw the permit/clearance.", collection: "tenants", where: { status: { equals: "pending" } } },
    { key: "qr-pending", tone: "todo", title: "GCash QRs to approve", hint: "Check the QR belongs to the store owner, then tick \"GCash QR approved\". Stores can't confirm orders until then.", collection: "tenants", where: { and: [{ gcashQr: { exists: true } }, { gcashQrApproved: { not_equals: true } }] } },
    { key: "riders-pending", tone: "todo", title: "Riders to approve", hint: "Check the LTO license + franchise (MTOP) documents (opening them is logged), then set \"approved\".", collection: "rider-profiles", where: { status: { equals: "pending" } } },
    // --- setup gaps ---
    { key: "stores-no-hours", tone: "setup", title: "Open stores without opening/closing times", hint: "Needed for the self-pickup rule and for reminders only during store hours.", collection: "tenants", where: { and: [{ status: { in: ["unverified", "verified"] } }, { or: [{ closingTime: { exists: false } }, { closingTime: { equals: "" } }] }] } },
  ];

  const items: QueueItem[] = [];
  for (const def of defs) {
    items.push({ key: def.key, tone: def.tone, title: def.title, hint: def.hint, count: await count(ctx, def.collection, def.where), href: listUrl(def.collection, def.where) });
  }

  // Setup checks that aren't a single list.
  // Map pins: an empty pin can be stored as {} (no filter matches that), so check them in code.
  const { docs: openStores } = await ctx.payload.find({
    collection: "tenants",
    where: { status: { in: ["unverified", "verified"] } },
    depth: 0,
    limit: 500,
    overrideAccess: true,
    req: ctx.req,
  });
  const noPin = openStores.filter((store) => !fromPoint(store.location as [number, number] | null | undefined)).length;
  items.push({
    key: "stores-no-pin",
    tone: "setup",
    title: "Open stores without a map pin",
    hint: "Riders are sorted by distance from the store's pin; without it the distance is unknown. Open each store and set its Map pin.",
    count: noPin,
    href: listUrl("tenants", { status: { in: "unverified,verified" } }),
  });
  const fares = await count(ctx, "fares", {});
  items.push({ key: "fares-missing", tone: "setup", title: "Delivery fares entered", hint: fares === 0 ? "No fares yet: checkout says \"Rider will tell you\". Add the rider organization's rates." : "Routes with a fare (casual + fast).", count: fares, href: "/admin/collections/fares" });
  const placeholder = settings.checkoutKeyPoints.includes("[Developer: write this]") || settings.signupKeyPoints.includes("[Developer: write this]");
  items.push({ key: "key-points", tone: "setup", title: "Sign-up / checkout key points still placeholders", hint: "Paste your own text in Settings (you write it; Claude doesn't).", count: placeholder ? 1 : 0, href: "/admin/globals/settings" });
  const legalPlaceholders = await count(ctx, "legal-pages", { version: { less_than_equal: 1 } });
  items.push({ key: "legal", tone: "setup", title: "Legal pages never updated (version 1)", hint: "Terms + Privacy Notice are yours to write before launch.", count: legalPlaceholders, href: "/admin/collections/legal-pages" });
  return items;
};

// What needs attention first: urgent ones with a count, then approvals, then setup gaps
export const attentionTotal = (items: QueueItem[]) =>
  items.filter((item) => item.tone !== "setup" && item.key !== "fares-missing").reduce((sum, item) => sum + item.count, 0);

export const recentAudit = async ({ payload, req }: Ctx, limit = 8) => {
  const { docs } = await payload.find({ collection: "audit-logs", sort: "-createdAt", depth: 1, limit, overrideAccess: true, req });
  return docs.map((doc) => ({
    id: doc.id,
    action: doc.action,
    at: doc.createdAt,
    actor: typeof doc.actor === "object" && doc.actor ? ((doc.actor as { email?: string }).email ?? "") : "system",
    target: doc.targetCollection ? `${doc.targetCollection}${doc.targetId ? ` · ${doc.targetId}` : ""}` : "",
  }));
};
