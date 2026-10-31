import type { Access, CollectionConfig, Where } from "payload";

import { isSeller, isSuperAdmin } from "@/lib/access";
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

  return { owner: { equals: req.user.id } } satisfies Where;
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
    delete: ownerOrSuperAdmin,
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
