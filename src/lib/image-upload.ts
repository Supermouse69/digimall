import { randomUUID } from "crypto";
import type { CollectionBeforeOperationHook, CollectionConfig } from "payload";

// Upload rules for every image collection (CLAUDE.md §10.8):
// - JPEG/PNG/WebP only. Payload checks the REAL file type, not just the name.
// - Re-encoded with sharp to WebP: this drops EXIF/GPS data (we never set withMetadata)
//   and anything hidden inside a fake "image".
// - Big photos are shrunk to max 2000px to keep pages light on mobile data.
// - Max 5 MB per file is set globally in payload.config.ts (upload.limits.fileSize).
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const imageUploadConfig = {
  mimeTypes: IMAGE_MIME_TYPES,
  formatOptions: { format: "webp", options: { quality: 82 } },
  resizeOptions: { width: 2000, height: 2000, fit: "inside", withoutEnlargement: true },
  withMetadata: false,
} satisfies Partial<Exclude<CollectionConfig["upload"], boolean | undefined>>;

// Random file names so nobody can guess other people's files or learn anything from the name
export const randomizeUploadFilename: CollectionBeforeOperationHook = ({ req, operation }) => {
  if ((operation === "create" || operation === "update") && req.file) {
    req.file.name = `${randomUUID()}.webp`;
  }
};
