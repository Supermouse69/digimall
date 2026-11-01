import { randomBytes } from "crypto";
import { commitTransaction, killTransaction, type Payload, type PayloadRequest } from "payload";

import { relationId } from "@/lib/private-files";
import { startTransaction } from "@/lib/transaction";
import type { Conversation, Message, Order, StoreOrder, Tenant, User } from "@/payload-types";

// Privacy requests (CLAUDE.md §9, Data Privacy Act): the super-admin can export a user's data and
// erase an account. Erasing keeps the ORDER records (legal/dispute reasons) but anonymizes them;
// the retention period for those records is the developer's decision (Privacy Notice).

type Ctx = { payload: Payload; req?: PayloadRequest };

const ACTIVE_ORDER = ["in_progress", "ready_to_book", "rider_requested", "rider_assigned", "on_the_way", "self_pickup"];
const OPEN_REFUND = ["awaiting_buyer_qr", "awaiting_store_refund", "refund_sent", "escalated"];

const all = async <T>({ payload, req }: Ctx, collection: Parameters<Payload["find"]>[0]["collection"], where: Parameters<Payload["find"]>[0]["where"], depth = 0) =>
  (await payload.find({ collection, where, depth, limit: 2000, overrideAccess: true, req })).docs as T[];

const audit = ({ payload, req }: Ctx, action: "privacy.exported" | "privacy.erased", adminId: string, targetId: string, details?: Record<string, unknown>) =>
  payload.create({ collection: "audit-logs", overrideAccess: true, req, data: { action, actor: adminId, targetCollection: "users", targetId, details } });

// ---------- export ----------

export const exportUserData = async (ctx: Ctx, userId: string, adminId: string) => {
  // showHiddenFields stays off: no password hash/salt, tokens, sessions or 2FA secrets
  const user = (await ctx.payload.findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true, req: ctx.req })) as User;
  const orders = await all<Order>(ctx, "orders", { buyer: { equals: userId } });
  const storeOrders = await all<StoreOrder>(ctx, "store-orders", { buyer: { equals: userId } }, 1);
  const conversations = await all<Conversation>(ctx, "conversations", { or: [{ buyer: { equals: userId } }, { rider: { equals: userId } }] });
  const messages = await all<Message>(ctx, "messages", { sender: { equals: userId } });
  const files = await all<{ id: string; purpose: string; createdAt: string }>(ctx, "private-media", { owner: { equals: userId } });
  const riderProfiles = await all<{ displayName: string; status: string; todaName?: string | null; createdAt: string }>(ctx, "rider-profiles", { user: { equals: userId } });

  const data = {
    exportedAt: new Date().toISOString(),
    note: "Your personal data held by DigiMall. Order Summary data is not an official receipt/invoice.",
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      username: user.chatName ?? null,
      role: user.role,
      phone: user.phone ?? null,
      deliveryAddress: user.buyerProfile ?? null,
      consents: user.consents ?? [],
      ageConfirmedAt: user.ageConfirmedAt ?? null,
      createdAt: user.createdAt,
    },
    riderProfile: riderProfiles.map((p) => ({ displayName: p.displayName, status: p.status, todaName: p.todaName ?? null, createdAt: p.createdAt })),
    orders: orders.map((order) => ({
      code: order.code,
      status: order.status,
      mode: order.mode,
      createdAt: order.createdAt,
      delivery: order.delivery,
      riderNotes: order.riderNotes ?? null,
      deliveryFeeEstimate: order.fare?.estimate ?? null,
      deliveryFeePaid: order.trip?.feeCollected ?? null,
      stores: storeOrders
        .filter((so) => relationId(so.order) === order.id)
        .map((so) => ({
          code: so.code,
          store: (so.tenant as Tenant | null)?.name ?? null,
          items: so.items,
          subtotal: so.subtotal,
          status: so.status,
          gcashReferenceNo: so.payment?.referenceNo ?? null,
          refund: so.refund?.status ? { status: so.refund.status, amount: so.refund.amount } : null,
        })),
    })),
    chats: conversations.map((c) => ({ id: c.id, type: c.type, lastMessageAt: c.lastMessageAt ?? null })),
    messagesYouSent: messages.map((m) => ({ chat: relationId(m.conversation), kind: m.kind, text: m.text ?? null, sentAt: m.createdAt })),
    filesYouUploaded: files.map((f) => ({ id: f.id, purpose: f.purpose, uploadedAt: f.createdAt })),
  };
  await audit(ctx, "privacy.exported", adminId, userId);
  return data;
};

// ---------- erase ----------

export type EraseResult = { erased: true; chatsDeleted: number; chatsKeptUnderReport: number; filesDeleted: number; filesKeptWithOrders: number; ordersAnonymized: number };

export class PrivacyError extends Error {}

// Checks that make erasing unsafe right now (finish or cancel these first)
export const eraseBlockers = async (ctx: Ctx, user: User) => {
  const problems: string[] = [];
  if (user.role === "super-admin") problems.push("Super-admin accounts can't be erased here.");
  if (user.role === "seller") problems.push("This is a store owner. Hand over or close the store first (stores and their orders are business records).");
  const active = await all<Order>(ctx, "orders", { and: [{ status: { in: ACTIVE_ORDER } }, { or: [{ buyer: { equals: user.id } }, { rider: { equals: user.id } }] }] });
  if (active.length > 0) problems.push(`Has ${active.length} order(s)/trip(s) still in progress: ${active.map((o) => o.code).join(", ")}.`);
  const refunds = await all<StoreOrder>(ctx, "store-orders", { and: [{ buyer: { equals: user.id } }, { "refund.status": { in: OPEN_REFUND } }] });
  if (refunds.length > 0) problems.push(`Has ${refunds.length} refund(s) still open: ${refunds.map((so) => so.code).join(", ")}.`);
  return problems;
};

export const eraseUser = async (ctx: Ctx, userId: string, adminId: string): Promise<EraseResult> => {
  const run = async (tx: Required<Ctx>): Promise<EraseResult> => {
    const user = (await tx.payload.findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true, req: tx.req })) as User;
    if ((user as { deletedAt?: string | null }).deletedAt) throw new PrivacyError("This account was already erased.");
    const blockers = await eraseBlockers(tx, user);
    if (blockers.length > 0) throw new PrivacyError(blockers.join(" "));

    // Files attached to order records (payment receipts, refund QRs/proofs) are kept with the orders
    const storeOrders = await all<StoreOrder>(tx, "store-orders", { buyer: { equals: userId } });
    const keepFiles = new Set(
      storeOrders.flatMap((so) => [relationId(so.payment?.receipt), relationId(so.refund?.buyerQr), relationId(so.refund?.proof)]).filter((id): id is string => Boolean(id)),
    );

    // 1. Chats (store + trip) — kept only while under a report (dispute)
    const conversations = await all<Conversation>(tx, "conversations", { or: [{ buyer: { equals: userId } }, { rider: { equals: userId } }] });
    let chatsDeleted = 0;
    let chatsKept = 0;
    for (const conversation of conversations) {
      if (conversation.underReport) {
        chatsKept++;
        continue;
      }
      const messages = await all<Message>(tx, "messages", { conversation: { equals: conversation.id } });
      for (const id of messages.map((m) => relationId(m.image)).filter((x): x is string => Boolean(x) && !keepFiles.has(x!))) {
        await tx.payload.delete({ collection: "private-media", id, overrideAccess: true, req: tx.req }).catch(() => undefined);
      }
      await tx.payload.delete({ collection: "messages", where: { conversation: { equals: conversation.id } }, overrideAccess: true, req: tx.req });
      await tx.payload.delete({ collection: "conversations", id: conversation.id, overrideAccess: true, req: tx.req });
      chatsDeleted++;
    }

    // 2. Their own private files (landmark photo, chat photos, rider documents...), except order proofs
    const files = await all<{ id: string }>(tx, "private-media", { owner: { equals: userId } });
    let filesDeleted = 0;
    for (const file of files) {
      if (keepFiles.has(file.id)) continue;
      await tx.payload.delete({ collection: "private-media", id: file.id, overrideAccess: true, req: tx.req });
      filesDeleted++;
    }

    // 3. Push subscriptions + rider profile
    await tx.payload.delete({ collection: "push-subscriptions", where: { user: { equals: userId } }, overrideAccess: true, req: tx.req });
    await tx.payload.delete({ collection: "rider-profiles", where: { user: { equals: userId } }, overrideAccess: true, req: tx.req });

    // 4. Orders stay (legal records) but without personal details
    const orders = await all<Order>(tx, "orders", { buyer: { equals: userId } });
    for (const order of orders) {
      await tx.payload.update({
        collection: "orders",
        id: order.id,
        data: { delivery: { buyerName: "Deleted user", barangay: order.delivery?.barangay ?? undefined, addressDetails: null, location: null, landmarkPhoto: null }, riderNotes: null },
        overrideAccess: true,
        req: tx.req,
      });
    }
    for (const so of storeOrders) {
      await tx.payload.update({ collection: "store-orders", id: so.id, data: { storeNotes: null }, overrideAccess: true, req: tx.req });
    }

    // 5. The account itself: anonymized, random password, no sessions, can never log in again
    await tx.payload.update({
      collection: "users",
      id: userId,
      data: {
        email: `deleted-${userId}@deleted.invalid`,
        name: "Deleted user",
        chatName: null,
        phone: null,
        buyerProfile: { barangay: null, addressDetails: null, landmarkPhoto: null, location: null },
        consents: [],
        password: randomBytes(32).toString("base64url"),
        deletedAt: new Date().toISOString(),
      } as never,
      overrideAccess: true,
      req: tx.req,
    });
    await tx.payload.db.updateOne({ collection: "users", id: userId, data: { sessions: [] }, req: tx.req });

    const result: EraseResult = { erased: true, chatsDeleted, chatsKeptUnderReport: chatsKept, filesDeleted, filesKeptWithOrders: [...keepFiles].length, ordersAnonymized: orders.length };
    await audit(tx, "privacy.erased", adminId, userId, { ...result, role: user.role });
    return result;
  };

  if (ctx.req) return run(ctx as Required<Ctx>);
  const req = await startTransaction(ctx.payload);
  try {
    const result = await run({ payload: ctx.payload, req });
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
};
