import type { CollectionConfig } from "payload";

import { anyone, superAdminOrOwnTenant, superAdminOrStoreMember } from "@/lib/access";

export const Products: CollectionConfig = {
  slug: "products",
  access: {
    read: anyone,
    create: superAdminOrStoreMember,
    update: superAdminOrOwnTenant("tenant"),
    delete: superAdminOrOwnTenant("tenant"),
  },

  fields: [
    {
      name: "name",
      type: "text",
      required: true,
    },
    {
      name: "description",
      type: "text",
    },
    {
        name: "price",
        type: "number",
        required: true,
        admin:{
            description: "Price in PHP"
        }
    },
    {
        name: "category",
        type: "relationship",
        relationTo: "categories",
        hasMany: false,
    }, 
     {
        name: "tags",
        type: "relationship",
        relationTo: "tags",
        hasMany: true,
    }, 
    {
        name: "image",
        type: "upload",
        relationTo: "media",
    },
    {
        name: "cover",
        type: "upload",
        relationTo: "media",
    },
    {
        name: "refundPolicy",
        type: "select",
        options: ["30-day", "14-day", "7-day", "3-day", "1-day", "no-refunds"],
        defaultValue: "30-day",
    },
  ],
};
