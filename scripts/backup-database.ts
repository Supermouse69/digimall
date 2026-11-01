// Run: bun run db:backup        (dev database, .env)
//      bun run prod:backup      (production database, .env.production)
// Saves every collection to backups/<database>-<date>.json on THIS PC. Read-only on the database.
// The file contains personal data: keep it private (backups/ is gitignored), don't share it,
// and delete old ones you don't need (CLAUDE.md §9).
import { mkdirSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = process.env.DATABASE_URI;
if (!uri) {
  console.log("DATABASE_URI is missing (check your .env / .env.production).");
  process.exit(1);
}

const client = await MongoClient.connect(uri);
const db = client.db();
const out: Record<string, unknown[]> = {};
for (const { name } of await db.listCollections().toArray()) {
  if (name.startsWith("system.")) continue;
  out[name] = await db.collection(name).find({}).toArray();
}
await client.close();

mkdirSync("backups", { recursive: true });
const file = `backups/${db.databaseName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out));
console.log(`Saved ${Object.keys(out).length} collections to ${file}`);
console.log(Object.entries(out).map(([name, docs]) => `  ${name}: ${docs.length}`).join("\n"));
process.exit(0);
