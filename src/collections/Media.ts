import type { CollectionConfig } from 'payload'

import { anyone, superAdminOnly, superAdminOrStoreMember } from "@/lib/access";
import { imageUploadConfig, randomizeUploadFilename } from "@/lib/image-upload";

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: superAdminOrStoreMember,
    // No owner field yet, so only the super-admin can edit or delete uploads
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  hooks: {
    beforeOperation: [randomizeUploadFilename],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  // Public images (products, store logos). Images only — blocks SVG/HTML that could run scripts.
  upload: {
    ...imageUploadConfig,
  },
}
