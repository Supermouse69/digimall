import type { PayloadRequest } from "payload";

import { relationId } from "@/lib/private-files";
import { noticeTemplate } from "@/modules/email/templates";

import { notifyUsers, sellerIdsOfStore } from "./push";

// Tell sellers/riders when the super-admin approves or suspends them (Phase 8).
// Called from the collections' afterChange hooks; never blocks or breaks the save.

type StoreDoc = { id: string; name?: string; status?: string; gcashQrApproved?: boolean | null };
type RiderDoc = { id: string; user?: unknown; status?: string };

export const storeChangeNotices = async (req: PayloadRequest, doc: StoreDoc, previous: StoreDoc | undefined) => {
  // Outside the save's transaction: a failed lookup here can never undo the approval itself
  const ctx = { payload: req.payload };
  const sellers = await sellerIdsOfStore(ctx, doc.id).catch(() => []);
  if (sellers.length === 0) return;
  const name = doc.name ?? "your store";
  const wasHidden = !previous?.status || previous.status === "pending" || previous.status === "suspended";

  if (wasHidden && (doc.status === "unverified" || doc.status === "verified")) {
    await notifyUsers(ctx, sellers, {
      title: "Your store is live",
      body: `${name} is now visible to buyers on DigiMall.`,
      url: "/admin",
      email: {
        subject: `${name} is live on DigiMall`,
        html: (person) =>
          noticeTemplate({ name: person, subject: "", heading: "your store is live", intro: `${name} is now visible to buyers. Add your products, and upload your GCash QR so you can accept orders.`, buttonLabel: "Open my store panel", path: "/admin" }).html,
      },
    });
  } else if (previous?.status !== "verified" && doc.status === "verified") {
    await notifyUsers(ctx, sellers, { title: "Business permit checked", body: `${name} now shows the "Business permit checked" badge.`, url: "/admin" });
  } else if (previous?.status !== "suspended" && doc.status === "suspended") {
    await notifyUsers(ctx, sellers, {
      title: "Store suspended",
      body: `${name} is hidden from buyers for now. Please contact the DigiMall admin.`,
      url: "/admin",
      email: {
        subject: `${name} is suspended on DigiMall`,
        html: (person) =>
          noticeTemplate({ name: person, subject: "", heading: "your store is suspended", intro: `${name} is hidden from buyers for now. Please contact the DigiMall admin to find out why and what to do next.`, buttonLabel: "Open my store panel", path: "/admin" }).html,
      },
    });
  }

  if (!previous?.gcashQrApproved && doc.gcashQrApproved) {
    await notifyUsers(ctx, sellers, { title: "GCash QR approved", body: `Buyers can now pay ${name}. You can confirm orders.`, url: "/seller/orders" });
  }
};

export const riderChangeNotices = async (req: PayloadRequest, doc: RiderDoc, previous: RiderDoc | undefined) => {
  const userId = relationId(doc.user);
  if (!userId || previous?.status === doc.status) return;
  // Outside the save's transaction: a failed lookup here can never undo the approval itself
  const ctx = { payload: req.payload };
  if (doc.status === "approved") {
    await notifyUsers(ctx, [userId], {
      title: "You're approved!",
      body: "Open the rider portal and tap Go Active to get ride requests.",
      url: "/rider",
      email: {
        subject: "You're approved as a DigiMall rider",
        html: (person) =>
          noticeTemplate({ name: person, subject: "", heading: "you're approved as a rider", intro: "Open the rider portal, add your mobile number, and tap Go Active to start getting ride requests.", buttonLabel: "Open the rider portal", path: "/rider" }).html,
      },
    });
  } else if (doc.status === "suspended") {
    await notifyUsers(ctx, [userId], { title: "Rider account on hold", body: "Please contact the DigiMall admin.", url: "/rider" });
  } else if (doc.status === "pending" && previous?.status === "approved") {
    await notifyUsers(ctx, [userId], { title: "Documents being checked", body: "You replaced a document, so the admin will check it again before you can ride.", url: "/rider" });
  }
};
