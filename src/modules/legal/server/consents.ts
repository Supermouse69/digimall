import type { Payload } from "payload";

import type { LegalPageSlug } from "@/collections/LegalPages";
import type { UserRole } from "@/modules/auth/roles";
import type { User } from "@/payload-types";

// Each role agrees to its own Terms + the Privacy Notice (CLAUDE.md §8). The super-admin writes them.
export const REQUIRED_DOCUMENTS: Record<UserRole, LegalPageSlug[]> = {
  buyer: ["terms-buyer", "privacy"],
  seller: ["terms-seller", "privacy"],
  rider: ["terms-rider", "privacy"],
  "super-admin": [],
};

export type LegalDocumentInfo = { slug: LegalPageSlug; title: string; version: number };

export const getLegalDocuments = async (
  payload: Payload,
  slugs: LegalPageSlug[],
): Promise<LegalDocumentInfo[]> => {
  if (slugs.length === 0) return [];
  const { docs } = await payload.find({
    collection: "legal-pages",
    where: { slug: { in: slugs } },
    depth: 0,
    limit: slugs.length,
    select: { slug: true, title: true, version: true },
  });
  // Keep the order of `slugs` (e.g. Terms first, then Privacy)
  return slugs
    .map((slug) => docs.find((doc) => doc.slug === slug))
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
    .map((doc) => ({ slug: doc.slug, title: doc.title, version: doc.version }));
};

// True when the user hasn't agreed to the current version of every required document.
export const needsConsent = (
  user: Pick<User, "role" | "consents">,
  current: LegalDocumentInfo[],
): boolean =>
  current.some(
    (doc) =>
      !(user.consents ?? []).some(
        (consent) => consent.document === doc.slug && consent.version >= doc.version,
      ),
  );

// New consent rows to append (we keep the history of older agreements too)
export const consentRecords = (docs: LegalDocumentInfo[], acceptedAt = new Date()) =>
  docs.map((doc) => ({
    document: doc.slug,
    version: doc.version,
    acceptedAt: acceptedAt.toISOString(),
  }));
