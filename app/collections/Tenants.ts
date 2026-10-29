import type { CollectionConfig } from 'payload'

import { anyone, superAdminOnly, superAdminOnlyField, superAdminOrOwnTenant } from "@/lib/access";

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  access: {
    read: anyone,
    // Stores are created only by the super-admin (CLAUDE.md §8)
    create: superAdminOnly,
    update: superAdminOrOwnTenant("id"),
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: 'slug',
  },
  fields: [
    {
      name: "name",
      required: true,
      type: "text",
      label: "Store Name",
      admin: {
        description: "This is the name of the store (e.g. Antonio's Store)",
      },
    },
    {
      name: "slug",
      type: "text",
      index: true,
      required: true,
      unique: true,
      access: {
        update: superAdminOnlyField,
      },
      admin: {
        description:
          "This is the subdomain for the store (e.g. [slug].funroad.com)",
      },
    },
    {
      name: "image",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "stripeAccountId",
      type: "text",
      required: true,
      access: {
        update: superAdminOnlyField,
      },
      admin: {
        readOnly: true,
      },
    },
    {
      name: "stripeDetailsSubmitted",
      type: "checkbox",
      access: {
        update: superAdminOnlyField,
      },
      admin: {
        readOnly: true,
        description: "You cannot create products until you submit your Stripe details",
      },
    },
  ],
};
