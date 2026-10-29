import type { CollectionConfig } from 'payload'

import { anyone, superAdminOnly } from "@/lib/access";

export const Tags: CollectionConfig = {
  slug: 'tags',
  access: {
    read: anyone,
    create: superAdminOnly,
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "name",
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
    },
    {
    name: "products",
    type: "relationship",
    relationTo: "products",
    hasMany:true,
    }
  ],
};
