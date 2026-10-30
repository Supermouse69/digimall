// Run: bun run test:access
// Calls the real (plugin-wrapped) access functions with fake users. No database access.
import { pathToFileURL } from "node:url";
import path from "node:path";

// The config needs these to build, but this test never connects to the database
process.env.PAYLOAD_SECRET ??= "access-test-only";
process.env.DATABASE_URI ??= "mongodb://127.0.0.1:1/unused";

const loadConfig = async () => {
  const mod = await import(pathToFileURL(path.resolve(process.cwd(), "src", "payload.config.ts")).href);
  return mod.default;
};

type U = Record<string, unknown> | null;
const anon: U = null;
const attacker: U = { id: "u-attacker", collection: "users", role: "buyer", tenants: [] };
const seller: U = { id: "u-seller", collection: "users", role: "seller", tenants: [{ tenant: "t-1" }] };
const admin: U = { id: "u-admin", collection: "users", role: "super-admin", tenants: [] };
const rider: U = { id: "u-rider", collection: "users", role: "rider", tenants: [] };
// A buyer who somehow got a store attached (e.g. old data) must NOT get seller powers
const buyerWithStore: U = { id: "u-bws", collection: "users", role: "buyer", tenants: [{ tenant: "t-1" }] };

let failed = 0;
const show = (r: unknown) => (typeof r === "object" ? JSON.stringify(r) : String(r));

// expect: true | false | "where" (a filter that limits to certain docs)
function check(label: string, result: unknown, expect: boolean | "where", whereMustInclude?: string) {
  let ok: boolean;
  if (expect === "where") {
    ok = typeof result === "object" && result !== null && (!whereMustInclude || JSON.stringify(result).includes(whereMustInclude));
  } else {
    ok = result === expect;
  }
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${show(result)}`);
}

const main = async () => {
  const config = (await (await loadConfig())) as {
    collections: { slug: string; access: unknown; fields: unknown; upload: unknown }[];
    globals: { slug: string; access: Record<string, (a: unknown) => unknown> }[];
  };
  const col = (slug: string) => config.collections.find((c) => c.slug === slug)!;
  const req = (user: U) => ({ user, payload: {}, context: {} }) as never;
  const acc = async (slug: string, op: string, user: U, id?: string) =>
    (col(slug).access as Record<string, (a: unknown) => unknown>)[op]!({ req: req(user), id });
  const field = (slug: string, name: string) =>
    (col(slug).fields as { name?: string; access?: Record<string, (a: unknown) => unknown>; fields?: unknown[] }[]).find((f) => f.name === name)!;
  const fieldAcc = async (slug: string, name: string, op: string, user: U) =>
    field(slug, name).access?.[op]?.({ req: req(user), id: "x" }) ?? "NO RULE";

  console.log("--- The takeover attack: attacker makes themselves super-admin ---");
  check("attacker: update role field", await fieldAcc("users", "role", "update", attacker), false);
  check("attacker: set role on create", await fieldAcc("users", "role", "create", attacker), false);
  check("seller: update role field", await fieldAcc("users", "role", "update", seller), false);
  check("admin: update role field", await fieldAcc("users", "role", "update", admin), true);
  check("attacker: attach self to a store (tenants field)", await fieldAcc("users", "tenants", "update", attacker), false);
  check("admin: attach user to a store", await fieldAcc("users", "tenants", "update", admin), true);

  console.log("--- Users collection ---");
  check("anonymous: read users", await acc("users", "read", anon), false);
  check("attacker: read users (own doc only)", await acc("users", "read", attacker), "where", "u-attacker");
  check("attacker: update users (own doc only)", await acc("users", "update", attacker, "u-seller"), "where", "u-attacker");
  check("attacker: create user via API", await acc("users", "create", attacker), false);
  check("anonymous: create user via API", await acc("users", "create", anon), false);
  check("attacker: delete users", await acc("users", "delete", attacker), false);
  check("attacker: open Payload admin", await acc("users", "admin", attacker), false);
  check("seller: open Payload admin", await acc("users", "admin", seller), true);
  check("rider: open Payload admin", await acc("users", "admin", rider), false);
  check("buyer with a store attached: open Payload admin", await acc("users", "admin", buyerWithStore), false);
  check("admin: open Payload admin", await acc("users", "admin", admin), true);
  check("admin: read all users", await acc("users", "read", admin), true);

  console.log("--- Stores (tenants) ---");
  check("anonymous: read stores (public pages)", await acc("tenants", "read", anon), true);
  check("attacker: create store", await acc("tenants", "create", attacker), false);
  check("seller: create store", await acc("tenants", "create", seller), false);
  check("attacker: update stores", await acc("tenants", "update", attacker), false);
  check("seller: update stores (own only)", await acc("tenants", "update", seller), "where", "t-1");
  check("seller: change store slug", await fieldAcc("tenants", "slug", "update", seller), false);
  check("seller: delete store", await acc("tenants", "delete", seller), false);
  check("admin: create store", await acc("tenants", "create", admin), true);

  console.log("--- Products ---");
  check("anonymous: read products", await acc("products", "read", anon), true);
  check("anonymous: create product", await acc("products", "create", anon), false);
  check("attacker (no store): create product", await acc("products", "create", attacker), false);
  check("attacker (no store): update products", await acc("products", "update", attacker), false);
  check("attacker (no store): delete products", await acc("products", "delete", attacker), false);
  check("seller: create product (own store only)", await acc("products", "create", seller), "where", "t-1");
  check("seller: update products (own store only)", await acc("products", "update", seller), "where", "t-1");
  check("seller: delete products (own store only)", await acc("products", "delete", seller), "where", "t-1");
  check("rider: create product", await acc("products", "create", rider), false);
  check("buyer with a store attached: create product", await acc("products", "create", buyerWithStore), false);
  check("buyer with a store attached: update products", await acc("products", "update", buyerWithStore), false);

  console.log("--- Categories, tags, media ---");
  for (const slug of ["categories", "tags"]) {
    check(`anonymous: read ${slug}`, await acc(slug, "read", anon), true);
    check(`seller: create ${slug}`, await acc(slug, "create", seller), false);
    check(`seller: update ${slug}`, await acc(slug, "update", seller), false);
    check(`seller: delete ${slug}`, await acc(slug, "delete", seller), false);
    check(`admin: create ${slug}`, await acc(slug, "create", admin), true);
  }
  check("anonymous: upload media", await acc("media", "create", anon), false);
  check("attacker (no store): upload media", await acc("media", "create", attacker), false);
  check("seller: upload media", await acc("media", "create", seller), true);
  check("seller: delete media", await acc("media", "delete", seller), false);
  const mime = (col("media").upload as { mimeTypes?: string[] }).mimeTypes;
  check("media: SVG uploads blocked", Boolean(mime && !mime.includes("image/svg+xml") && mime.length === 3), true);

  console.log("--- Legal pages + settings ---");
  check("anonymous: read legal pages", await acc("legal-pages", "read", anon), true);
  check("seller: edit legal pages", await acc("legal-pages", "update", seller), false);
  check("buyer: create legal page", await acc("legal-pages", "create", attacker), false);
  check("admin: edit legal pages", await acc("legal-pages", "update", admin), true);
  const settings = config.globals.find((g) => g.slug === "settings")!;
  check("anonymous: read settings via API", await settings.access.read!({ req: req(anon) }), false);
  check("seller: read settings via API", await settings.access.read!({ req: req(seller) }), false);
  check("buyer: change settings", await settings.access.update!({ req: req(attacker) }), false);
  check("admin: change settings", await settings.access.update!({ req: req(admin) }), true);

  console.log("--- Consent records can't be faked ---");
  check("buyer: edit own consents", await fieldAcc("users", "consents", "update", attacker), false);
  check("buyer: set consents on create", await fieldAcc("users", "consents", "create", attacker), false);
  check("buyer: edit own age-confirmed time", await fieldAcc("users", "ageConfirmedAt", "update", attacker), false);
  check("admin: edit consents", await fieldAcc("users", "consents", "update", admin), true);

  console.log("--- Private files (IDs, licenses, landmark photos) ---");
  check("anonymous: read private files", await acc("private-media", "read", anon), false);
  check("buyer: read private files (own only)", await acc("private-media", "read", attacker), "where", "u-attacker");
  check("seller: read private files (own only)", await acc("private-media", "read", seller), "where", "u-seller");
  check("rider: read private files (own only)", await acc("private-media", "read", rider), "where", "u-rider");
  check("admin: read private files", await acc("private-media", "read", admin), true);
  check("anonymous: upload private file", await acc("private-media", "create", anon), false);
  check("rider: upload private file", await acc("private-media", "create", rider), true);
  check("rider: edit a private file", await acc("private-media", "update", rider), false);
  check("buyer: delete private files (own only)", await acc("private-media", "delete", attacker), "where", "u-attacker");
  check("rider: change a file's owner", await fieldAcc("private-media", "owner", "update", rider), false);
  check("admin: change a file's owner", await fieldAcc("private-media", "owner", "update", admin), false);
  const privateUpload = col("private-media").upload as { mimeTypes?: string[]; staticDir?: string; withMetadata?: boolean };
  check("private files: images only", JSON.stringify(privateUpload.mimeTypes), JSON.stringify(["image/jpeg", "image/png", "image/webp"]) as never);
  check("private files: not stored in public folders", privateUpload.staticDir === "private-media", true);
  check("private files: EXIF/GPS stripped", privateUpload.withMetadata === false, true);

  console.log("--- Rider profiles ---");
  check("anonymous: read rider profiles", await acc("rider-profiles", "read", anon), false);
  check("rider: read rider profiles (own only)", await acc("rider-profiles", "read", rider), "where", "u-rider");
  check("buyer: read rider profiles (own only = none)", await acc("rider-profiles", "read", attacker), "where", "u-attacker");
  check("rider: create a rider profile", await acc("rider-profiles", "create", rider), false);
  check("rider: approve themselves (status)", await fieldAcc("rider-profiles", "status", "update", rider), false);
  check("rider: turn on Active before Phase 6", await fieldAcc("rider-profiles", "isActive", "update", rider), false);
  check("rider: change which user a profile belongs to", await fieldAcc("rider-profiles", "user", "update", rider), false);
  check("admin: approve riders", await fieldAcc("rider-profiles", "status", "update", admin), true);
  check("rider: delete rider profile", await acc("rider-profiles", "delete", rider), false);

  console.log("--- Invites ---");
  for (const [who, user] of [["anonymous", anon], ["buyer", attacker], ["seller", seller], ["rider", rider]] as const) {
    check(`${who}: read invites`, await acc("invites", "read", user), false);
    check(`${who}: create invite`, await acc("invites", "create", user), false);
  }
  check("admin: create invite", await acc("invites", "create", admin), true);
  check("admin: change invite email after sending", await fieldAcc("invites", "email", "update", admin), false);
  check("admin: change invite role after sending", await fieldAcc("invites", "role", "update", admin), false);

  console.log("--- Audit log (append-only) ---");
  check("seller: read audit log", await acc("audit-logs", "read", seller), false);
  check("admin: read audit log", await acc("audit-logs", "read", admin), true);
  check("admin: create audit entry by hand", await acc("audit-logs", "create", admin), false);
  check("admin: edit audit entry", await acc("audit-logs", "update", admin), false);
  check("admin: delete audit entry", await acc("audit-logs", "delete", admin), false);
  const publicUpload = col("media").upload as { withMetadata?: boolean; formatOptions?: { format?: string } };
  check("public images: EXIF/GPS stripped + re-encoded", publicUpload.withMetadata === false && publicUpload.formatOptions?.format === "webp", true);

  console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
