import type { CollectionConfig } from 'payload'

import { anyone, superAdminOnly, superAdminOrStoreMember } from "@/lib/access";

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: superAdminOrStoreMember,
    // No owner field yet, so only the super-admin can edit or delete uploads
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    // Images only. Blocks SVG/HTML uploads, which could run scripts on our domain.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
}
