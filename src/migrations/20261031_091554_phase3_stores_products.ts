import {
  MigrateDownArgs,
  MigrateUpArgs,
} from '@payloadcms/db-mongodb'

// Phase 3a: stores get a status + more fields; product tags are removed (developer decision 2026-10-31).
// - tenants.image -> tenants.logo (same picture, new name)
// - every existing store without a status: "unverified" (stays visible, developer's choice),
//   except the seed's placeholder "admin" store: "pending" (hidden)
// - products: tags removed, isAvailable = true, isHidden = false where missing
// - the tags collection is dropped (a backup is made before running this; see backups/)

const collectionOf = (payload: MigrateUpArgs['payload'], slug: string) =>
  payload.db.collections[slug]!.collection

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const tenants = collectionOf(payload, 'tenants')
  const products = collectionOf(payload, 'products')

  const renamed = await tenants.updateMany(
    { image: { $exists: true }, logo: { $exists: false } },
    { $rename: { image: 'logo' } },
    { session },
  )
  const hidden = await tenants.updateMany(
    { slug: 'admin', status: { $exists: false } },
    { $set: { status: 'pending', gcashQrApproved: false } },
    { session },
  )
  const visible = await tenants.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'unverified', gcashQrApproved: false } },
    { session },
  )
  payload.logger.info(
    `tenants: ${renamed.modifiedCount} image->logo, ${visible.modifiedCount} set unverified, ${hidden.modifiedCount} set pending`,
  )

  const untagged = await products.updateMany({ tags: { $exists: true } }, { $unset: { tags: '' } }, { session })
  const available = await products.updateMany({ isAvailable: { $exists: false } }, { $set: { isAvailable: true } }, { session })
  const notHidden = await products.updateMany({ isHidden: { $exists: false } }, { $set: { isHidden: false } }, { session })
  payload.logger.info(
    `products: ${untagged.modifiedCount} tags removed, ${available.modifiedCount} set available, ${notHidden.modifiedCount} set not hidden`,
  )

  // Admin-panel preferences for the removed collection (column layouts etc.)
  const db = payload.db.connection.db!
  await db.collection('payload-preferences').deleteMany({ key: /tags/ }, { session })

  // Dropping a collection can't run inside a transaction; it only runs once the updates above worked
  const exists = await db.listCollections({ name: 'tags' }).toArray()
  if (exists.length > 0) {
    await db.dropCollection('tags')
    payload.logger.info('tags: collection dropped')
  }
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  // Puts the old field names back. The deleted tags themselves can only come back from the backup file.
  const tenants = collectionOf(payload, 'tenants')
  const products = collectionOf(payload, 'products')
  await tenants.updateMany(
    { logo: { $exists: true }, image: { $exists: false } },
    { $rename: { logo: 'image' } },
    { session },
  )
  await tenants.updateMany({}, { $unset: { status: '', gcashQrApproved: '' } }, { session })
  await products.updateMany({}, { $unset: { isAvailable: '', isHidden: '' } }, { session })
}
