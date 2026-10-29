import {
  MigrateDownArgs,
  MigrateUpArgs,
} from '@payloadcms/db-mongodb'

import {
  DEFAULT_BARANGAYS,
  DEFAULT_MINIMUM_AGE,
  DEFAULT_SERVICE_CENTER,
  DEFAULT_SERVICE_RADIUS_KM,
} from '../globals/Settings'

// Phase 2b: blank legal page placeholders (the developer writes the text) + default settings.

const PLACEHOLDER = '[Developer: write this]'

const LEGAL_PAGES = [
  { slug: 'terms-buyer', title: 'Terms of Service for Buyers' },
  { slug: 'terms-seller', title: 'Terms of Service for Sellers' },
  { slug: 'terms-rider', title: 'Terms of Service for Riders' },
  { slug: 'privacy', title: 'Privacy Notice' },
] as const

// Minimal rich-text (Lexical) document with one paragraph
const placeholderContent = () => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph',
        format: '' as const,
        indent: 0,
        version: 1,
        direction: 'ltr' as const,
        textFormat: 0,
        children: [
          { type: 'text', text: PLACEHOLDER, format: 0, detail: 0, mode: 'normal', style: '', version: 1 },
        ],
      },
    ],
  },
})

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  for (const page of LEGAL_PAGES) {
    const existing = await payload.find({
      collection: 'legal-pages',
      where: { slug: { equals: page.slug } },
      limit: 1,
      req,
    })
    if (existing.docs.length > 0) continue

    await payload.create({
      collection: 'legal-pages',
      data: { slug: page.slug, title: page.title, content: placeholderContent(), version: 1 },
      req,
    })
    payload.logger.info(`legal-pages: created placeholder "${page.slug}"`)
  }

  const settings = await payload.findGlobal({ slug: 'settings', req })
  if (!settings?.updatedAt) {
    await payload.updateGlobal({
      slug: 'settings',
      data: {
        barangays: DEFAULT_BARANGAYS.map((name) => ({ name })),
        serviceCenter: [DEFAULT_SERVICE_CENTER.lng, DEFAULT_SERVICE_CENTER.lat],
        serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
        minimumAge: DEFAULT_MINIMUM_AGE,
        signupKeyPoints: PLACEHOLDER,
      },
      req,
    })
    payload.logger.info('settings: saved defaults')
  }
}

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  // Only removes pages that still hold the untouched placeholder text — never the developer's writing.
  const pages = await payload.find({ collection: 'legal-pages', limit: 10, req })
  for (const page of pages.docs) {
    if (JSON.stringify(page.content).includes(PLACEHOLDER)) {
      await payload.delete({ collection: 'legal-pages', id: page.id, req })
    }
  }
}
