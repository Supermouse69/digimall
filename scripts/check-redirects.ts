// Run: bun run test:redirects
// Checks that login redirects can never send someone to another website.
import { homeForRole, safeRedirectPath } from "../src/modules/auth/roles";

const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);

const cases: [label: string, got: string, want: string][] = [
  ["buyer goes back to a normal page", homeForRole("buyer", "/tenants/zaritenant"), "/tenants/zaritenant"],
  ["query string is kept", homeForRole("buyer", "/tenants/x?page=2"), "/tenants/x?page=2"],
  ["no next -> home", homeForRole("buyer", undefined), "/"],
  ["protocol-relative //evil", homeForRole("buyer", "//evil.example"), "/"],
  ["full URL https://evil", homeForRole("buyer", "https://evil.example"), "/"],
  ["backslash /\\evil", homeForRole("buyer", "/" + BACKSLASH + "evil.example"), "/"],
  ["tab trick /<tab>/evil", homeForRole("buyer", "/" + TAB + "/evil.example"), "/"],
  ["newline trick /<nl>/evil", homeForRole("buyer", "/" + NEWLINE + "/evil.example"), "/"],
  ["javascript: URL", safeRedirectPath("javascript:alert(1)"), "/"],
  ["seller always -> /admin", homeForRole("seller", "/tenants/x"), "/admin"],
  ["super-admin -> /admin", homeForRole("super-admin", null), "/admin"],
  ["rider -> /rider", homeForRole("rider", "/"), "/rider"],
];

let failed = 0;
for (const [label, got, want] of cases) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
