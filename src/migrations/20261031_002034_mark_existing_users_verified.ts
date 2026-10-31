import {
  MigrateDownArgs,
  MigrateUpArgs,
} from '@payloadcms/db-mongodb'

// Fix for Phase 2c: email verification was turned on after these accounts existed.
// Payload's login only blocks accounts marked `_verified: false`, but its session check needs
// `_verified: true` — so older accounts could log in and were then treated as logged out.
// Only touches accounts with NO verified status at all (created before verification existed).
// Buyers waiting to confirm their email have `_verified: false` and are left alone.

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const users = payload.db.collections['users']!.collection
  const result = await users.updateMany(
    { _verified: { $exists: false } },
    { $set: { _verified: true, _verifiedBeforeEmailCheck: true } },
    { session },
  )
  payload.logger.info(`users: marked ${result.modifiedCount} pre-existing account(s) as verified`)
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const users = payload.db.collections['users']!.collection
  await users.updateMany(
    { _verifiedBeforeEmailCheck: true },
    { $unset: { _verified: '', _verifiedBeforeEmailCheck: '' } },
    { session },
  )
}
