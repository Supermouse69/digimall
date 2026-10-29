// Run: bun run test:access
// Calls the real (plugin-wrapped) access functions with fake users. No database access.
import { pathToFileURL } from "node:url";
import path from "node:path";

const loadConfig = async () => {
  const mod = await import(pathToFileURL(path.resolve(process.cwd(), "payload.config.ts")).href);
  return mod.default;
};

type U = Record<string, unknown> | null;
const anon: U = null;
const attacker: U = { id: "u-attacker", collection: "users", roles: ["user"], tenants: [] };
const seller: U = { id: "u-seller", collection: "users", roles: ["user"], tenants: [{ tenant: "t-1" }] };
const admin: U = { id: "u-admin", collection: "users", roles: ["super-admin"], tenants: [] };

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
  const config = (await (await loadConfig())) as { collections: { slug: string; access: unknown; fields: unknown; upload: unknown }[] };
  const col = (slug: string) => config.collections.find((c) => c.slug === slug)!;
  const req = (user: U) => ({ user, payload: {}, context: {} }) as never;
  const acc = async (slug: string, op: string, user: U, id?: string) =>
    (col(slug).access as Record<string, (a: unknown) => unknown>)[op]!({ req: req(user), id });
  const field = (slug: string, name: string) =>
    (col(slug).fields as { name?: string; access?: Record<string, (a: unknown) => unknown>; fields?: unknown[] }[]).find((f) => f.name === name)!;
  const fieldAcc = async (slug: string, name: string, op: string, user: U) =>
    field(slug, name).access?.[op]?.({ req: req(user), id: "x" }) ?? "NO RULE";

  console.log("--- The takeover attack: attacker makes themselves super-admin ---");
  check("attacker: update roles field", await fieldAcc("users", "roles", "update", attacker), false);
  check("attacker: set roles on create", await fieldAcc("users", "roles", "create", attacker), false);
  check("seller: update roles field", await fieldAcc("users", "roles", "update", seller), false);
  check("admin: update roles field", await fieldAcc("users", "roles", "update", admin), true);
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

  console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
