import type { CollectionConfig } from "payload";

import { anyone, superAdminOnly } from "@/lib/access";

export const LEGAL_PAGE_SLUGS = ["terms-buyer", "terms-seller", "terms-rider", "privacy"] as const;
export type LegalPageSlug = (typeof LEGAL_PAGE_SLUGS)[number];

// The developer writes all legal text (CLAUDE.md §3 "Never"). The app only stores and shows it,
// and remembers which version each user agreed to.
export const LegalPages: CollectionConfig = {
  slug: "legal-pages",
  labels: { singular: "Legal page", plural: "Legal pages" },
  access: {
    read: anyone,
    create: superAdminOnly,
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "version", "publishedAt"],
    hidden: ({ user }) => (user as { role?: string } | null)?.role !== "super-admin",
  },
  fields: [
    {
      name: "slug",
      type: "select",
      required: true,
      unique: true,
      index: true,
      options: LEGAL_PAGE_SLUGS.map((slug) => ({ label: slug, value: slug })),
      access: { update: () => false },
    },
    { name: "title", type: "text", required: true, maxLength: 120 },
    { name: "content", type: "richText", required: true },
    {
      name: "version",
      type: "number",
      required: true,
      min: 1,
      defaultValue: 1,
      admin: {
        position: "sidebar",
        description:
          "Raise this number for real changes. Users who agreed to an older version must agree again. Leave it for typo fixes.",
      },
    },
    {
      name: "publishedAt",
      type: "date",
      admin: { position: "sidebar", date: { pickerAppearance: "dayAndTime" } },
    },
  ],
};
