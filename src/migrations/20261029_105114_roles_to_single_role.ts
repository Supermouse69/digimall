import {
  MigrateDownArgs,
  MigrateUpArgs,
} from '@payloadcms/db-mongodb'

// Phase 2a: users.roles (array: super-admin | user) + username
//        -> users.role (one of: buyer | seller | rider | super-admin) + name
//
// Mapping: super-admin stays super-admin; anyone linked to a store becomes seller; everyone else buyer.
// The old unique `username` index is dropped, otherwise a 2nd account without a username would be
// rejected as a duplicate.

type OldUser = {
  email?: string
  roles?: string[]
  username?: string
  name?: string
  role?: string
  tenants?: unknown[]
}

const usersCollection = (payload: MigrateUpArgs['payload']) =>
  payload.db.collections['users']!.collection

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const users = usersCollection(payload)
  const docs = await users.find({}, { session }).toArray()

  for (const raw of docs) {
    const doc = raw as unknown as OldUser
    const role = doc.roles?.includes('super-admin')
      ? 'super-admin'
      : (doc.tenants?.length ?? 0) > 0
        ? 'seller'
        : 'buyer'
    const name = doc.name || doc.username || doc.email?.split('@')[0] || 'User'

    await users.updateOne(
      { _id: raw._id },
      { $set: { role, name }, $unset: { roles: '', username: '' } },
      { session },
    )
    payload.logger.info(`users: ${doc.email} -> role=${role}`)
  }

  const indexes = await users.indexes()
  if (indexes.some((index) => index.name === 'username_1')) {
    await users.dropIndex('username_1')
    payload.logger.info('users: dropped unique index username_1')
  }
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const users = usersCollection(payload)
  const docs = await users.find({}, { session }).toArray()

  for (const raw of docs) {
    const doc = raw as unknown as OldUser
    const roles = doc.role === 'super-admin' ? ['super-admin'] : ['user']
    // Best effort: the old username must be lowercase letters, numbers and hyphens
    const username =
      (doc.name || doc.email?.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9-]+/g, '-') +
      '-' +
      String(raw._id).slice(-4)

    await users.updateOne(
      { _id: raw._id },
      { $set: { roles, username }, $unset: { role: '', name: '' } },
      { session },
    )
  }
  // Payload re-creates the username index from the (old) config on next start.
}
