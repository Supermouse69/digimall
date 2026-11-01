import type { Access, CollectionConfig, Where } from "payload";

import { getUserTenantIds, isSeller, isSuperAdmin } from "@/lib/access";
import { imageUploadConfig, randomizeUploadFilename } from "@/lib/image-upload";
import { relationId as ownerId } from "@/lib/private-files";
import { writeAuditLog } from "@/modules/audit/server/audit-log";

export const PRIVATE_MEDIA_PURPOSES = [
  "rider-photo",
  "rider-license",
  "rider-franchise",
  "landmark",
  "store-gcash-qr",
  "store-permit",
  "store-bir",
  "store-dti-sec",
  "chat-image",
  "payment-receipt",
  "refund-qr",
  "refund-proof",
] as const;
export type PrivateMediaPurpose = (typeof PRIVATE_MEDIA_PURPOSES)[number];

// Owner or super-admin only. Used for the document AND for the file download
// (/api/private-media/file/<name>), because Payload runs this same check for files.
const ownerOrSuperAdmin: Access = async ({ req, data }) => {
  if (!req.user || req.user.collection !== "users") return false;

  if (isSuperAdmin(req.user)) {
    // A file download passes the filename: log it when it isn't the super-admin's own file
    const filename = (data as { filename?: string } | undefined)?.filename;
    if (filename) {
      const { docs } = await req.payload.find({
        collection: "private-media",
        where: { filename: { equals: filename } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      const file = docs[0];
      if (file && ownerId(file.owner) !== req.user.id) {
        await writeAuditLog(req, {
          action: "private_file.viewed",
          targetCollection: "private-media",
          targetId: file.id,
          details: { purpose: file.purpose, via: "file" },
        });
      }
    }
    return true;
  }

  // Chat photos + payment receipts: the other person in that chat may see them too (buyer <-> store).
  // Store GCash QR: a buyer sees it only while one of their orders from that store is waiting
  // for payment, and only once the super-admin approved it (CLAUDE.md §10 table, §11.1).
  // Trips (Phase 6): the assigned rider sees the buyer's landmark photo only during the trip;
  // a buyer who is booking sees approved riders' photos (the rider list shows them).
  const [chatIds, qrIds, landmarkIds, riderPhotoOwners] = await Promise.all([
    myConversationIds(req),
    payableQrIds(req),
    activeTripLandmarkIds(req),
    bookableRiderPhotoOwners(req),
  ]);
  const allowed: Where[] = [{ owner: { equals: req.user.id } }];
  if (chatIds.length > 0) allowed.push({ conversation: { in: chatIds } });
  if (qrIds.length > 0) allowed.push({ id: { in: qrIds } });
  if (landmarkIds.length > 0) allowed.push({ id: { in: landmarkIds } });
  if (riderPhotoOwners.length > 0) allowed.push({ and: [{ purpose: { equals: "rider-photo" } }, { owner: { in: riderPhotoOwners } }] });
  return allowed.length > 1 ? { or: allowed } : allowed[0]!;
};

const ACTIVE_TRIP = ["rider_assigned", "on_the_way"];

const activeTripLandmarkIds = async (req: Parameters<Access>[0]["req"]): Promise<string[]> => {
  if (!req.user || (req.user as { role?: string }).role !== "rider") return [];
  const { docs } = await req.payload.find({
    collection: "orders",
    where: { and: [{ rider: { equals: req.user.id } }, { status: { in: ACTIVE_TRIP } }] },
    depth: 0,
    limit: 5,
    overrideAccess: true,
    req,
  });
  return docs.map((order) => ownerId(order.delivery?.landmarkPhoto)).filter((id): id is string => Boolean(id));
};

const bookableRiderPhotoOwners = async (req: Parameters<Access>[0]["req"]): Promise<string[]> => {
  if (!req.user || (req.user as { role?: string }).role !== "buyer") return [];
  const { totalDocs } = await req.payload.count({
    collection: "orders",
    where: { and: [{ buyer: { equals: req.user.id } }, { status: { in: ["ready_to_book", "rider_requested", ...ACTIVE_TRIP] } }] },
    overrideAccess: true,
    req,
  });
  if (totalDocs === 0) return [];
  const { docs } = await req.payload.find({
    collection: "rider-profiles",
    where: { status: { equals: "approved" } },
    depth: 0,
    limit: 200,
    overrideAccess: true,
    req,
  });
  return docs.map((profile) => ownerId(profile.user)).filter((id): id is string => Boolean(id));
};

const payableQrIds = async (req: Parameters<Access>[0]["req"]): Promise<string[]> => {
  if (!req.user || (req.user as { role?: string }).role !== "buyer") return [];
  const { docs: storeOrders } = await req.payload.find({
    collection: "store-orders",
    where: { and: [{ buyer: { equals: req.user.id } }, { status: { in: ["awaiting_payment", "payment_submitted"] } }] },
    depth: 0,
    limit: 50,
    overrideAccess: true,
    req,
  });
  const tenantIds = [...new Set(storeOrders.map((so) => ownerId(so.tenant)).filter((id): id is string => Boolean(id)))];
  if (tenantIds.length === 0) return [];
  const { docs: stores } = await req.payload.find({
    collection: "tenants",
    where: { and: [{ id: { in: tenantIds } }, { gcashQrApproved: { equals: true } }] },
    depth: 0,
    limit: 50,
    overrideAccess: true,
    req,
  });
  return stores.map((store) => ownerId(store.gcashQr)).filter((id): id is string => Boolean(id));
};

// Chats this user is part of: as the buyer, or as the seller of the store
const myConversationIds = async (req: Parameters<Access>[0]["req"]): Promise<string[]> => {
  if (!req.user) return [];
  const tenantIds = getUserTenantIds(req.user);
  const role = (req.user as { role?: string }).role;
  const where: Where =
    tenantIds.length > 0
      ? { tenant: { in: tenantIds } }
      : role === "rider"
        ? { rider: { equals: req.user.id } }
        : { buyer: { equals: req.user.id } };
  const { docs } = await req.payload.find({
    collection: "conversations",
    where,
    depth: 0,
    limit: 1000,
    overrideAccess: true,
    req,
    select: {},
  });
  return docs.map((doc) => String(doc.id));
};

// Sensitive files: IDs, licenses, franchise permits, landmark photos (CLAUDE.md §9, §10.8).
// Stored outside /public and outside the public media folder; never readable by visitors.
export const PrivateMedia: CollectionConfig = {
  slug: "private-media",
  labels: { singular: "Private file", plural: "Private files" },
  access: {
    read: ownerOrSuperAdmin,
    // Any logged-in user can upload their own file (the owner is set on the server below)
    create: ({ req }) => Boolean(req.user && req.user.collection === "users"),
    // No editing: upload a new file instead
    update: ({ req }) => isSuperAdmin(req.user),
    // Deleting: only the file's owner (never the other person in a chat) or the super-admin
    delete: ({ req }) => {
      if (!req.user || req.user.collection !== "users") return false;
      if (isSuperAdmin(req.user)) return true;
      return { owner: { equals: req.user.id } } satisfies Where;
    },
  },
  admin: {
    useAsTitle: "filename",
    defaultColumns: ["filename", "purpose", "owner", "createdAt"],
    // Sellers need it for uploading their GCash QR / store documents (they only ever see their own files)
    hidden: ({ user }) => !isSuperAdmin(user) && !isSeller(user),
  },
  hooks: {
    beforeOperation: [randomizeUploadFilename],
    beforeChange: [
      ({ data, operation, req }) => {
        // The owner is always the uploader. Never trust an owner sent by the browser.
        if (operation === "create" && req.user) {
          return { ...data, owner: req.user.id };
        }
        return data;
      },
    ],
    afterRead: [
      async ({ doc, req, findMany }) => {
        // Log when the super-admin opens someone else's private file record
        if (!findMany && req.user && isSuperAdmin(req.user) && ownerId(doc.owner) !== req.user.id) {
          await writeAuditLog(req, {
            action: "private_file.viewed",
            targetCollection: "private-media",
            targetId: doc.id,
            details: { purpose: doc.purpose, via: "record" },
          });
        }
        return doc;
      },
    ],
  },
  upload: {
    ...imageUploadConfig,
    staticDir: "private-media",
  },
  fields: [
    {
      name: "owner",
      type: "relationship",
      relationTo: "users",
      index: true,
      access: {
        // Set by the server on create; nobody can change who owns a file
        update: () => false,
      },
      admin: { readOnly: true },
    },
    {
      // Chat photos only: set by the chat server code when the photo is sent in a chat
      name: "conversation",
      type: "relationship",
      relationTo: "conversations",
      index: true,
      access: { create: () => false, update: () => false },
      admin: { readOnly: true, condition: (data) => data?.purpose === "chat-image" },
    },
    {
      name: "purpose",
      type: "select",
      required: true,
      options: [...PRIVATE_MEDIA_PURPOSES],
      access: { update: () => false },
      admin: {
        description:
          "What this file is for. Store files: store-gcash-qr, store-permit (business permit or barangay clearance), store-bir, store-dti-sec.",
      },
    },
  ],
};
