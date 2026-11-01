import type { PayloadRequest } from "payload";

import { isSuperAdmin } from "@/lib/access";

export type PrivateFilePurpose =
  | "rider-photo"
  | "rider-license"
  | "rider-franchise"
  | "landmark"
  | "store-gcash-qr"
  | "store-permit"
  | "store-bir"
  | "store-dti-sec"
  | "chat-image"
  | "payment-receipt"
  | "refund-qr"
  | "refund-proof";

// A relationship value can be an ID or a populated document
export const relationId = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String(value.id);
  return null;
};

// Field validator: a user may only attach a private file THEY uploaded, with the matching purpose.
// Stops someone from linking another person's ID or photo by guessing its file ID.
export const ownPrivateFile =
  (purpose: PrivateFilePurpose) =>
  async (value: unknown, { req }: { req: PayloadRequest }): Promise<true | string> => {
    const id = relationId(value);
    if (!id || isSuperAdmin(req.user)) return true;
    const file = await req.payload
      // Same request = same database transaction, so a file uploaded moments ago is visible
      .findByID({ collection: "private-media", id, depth: 0, overrideAccess: true, req })
      .catch(() => null);
    if (!file) return "File not found.";
    if (relationId(file.owner) !== req.user?.id || file.purpose !== purpose) {
      return "You can only attach files you uploaded yourself.";
    }
    return true;
  };
