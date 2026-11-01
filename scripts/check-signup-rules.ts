// Run: bun run test:signup
// Checks the sign-up rules that don't need a database: phone format, delivery area, re-consent.
import { distanceKm } from "../src/lib/geo";
import { isPhMobile, normalizePhMobile } from "../src/lib/ph-phone";
import { needsConsent } from "../src/modules/legal/server/consents";
import { registerSchema } from "../src/modules/auth/schemas";
import { buyerDisplayName } from "../src/lib/chat-name";
import { isInServiceArea, toKeyPointList, type MarketplaceSettings } from "../src/modules/settings/server/settings";

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
};

console.log("--- Phone numbers ---");
check("09XXXXXXXXX ok", isPhMobile("09171234567"), true);
check("+639XXXXXXXXX ok", isPhMobile("+639171234567"), true);
check("spaces/dashes ok", isPhMobile("0917 123-4567"), true);
check("too short", isPhMobile("0917123456"), false);
check("landline", isPhMobile("0281234567"), false);
check("letters", isPhMobile("0917abc4567"), false);
check("normalize 09 -> +639", normalizePhMobile("0917 123 4567"), "+639171234567");
check("normalize keeps +639", normalizePhMobile("+639171234567"), "+639171234567");

console.log("--- Delivery area ---");
const settings: MarketplaceSettings = {
  barangays: ["San Marcos"],
  serviceCenter: { lat: 14.916, lng: 120.766 },
  serviceRadiusKm: 8,
  minimumAge: 18,
  signupKeyPoints: "",
  checkoutKeyPoints: "",
  chatRetentionDays: 90,
  maxStoresPerCart: 3,
  storeConfirmMinutes: 10,
  paymentMinutes: 10,
  paymentCheckReminderMinutes: 30,
  fareExtraStopFee: 0,
  riderRequestSeconds: 120,
  riderLocationFreshMinutes: 5,
};
check("center is inside", isInServiceArea(settings, { lat: 14.916, lng: 120.766 }), true);
check("~3 km away is inside", isInServiceArea(settings, { lat: 14.943, lng: 120.766 }), true);
check("Manila is outside", isInServiceArea(settings, { lat: 14.5995, lng: 120.9842 }), false);
check("1 degree latitude ~ 111 km", Math.round(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })), 111);

console.log("--- Key points box ---");
const messy = ["* One", "", "- Two", "\u2022  Three", "   "].join("\r\n");
check("bullets and blank lines cleaned", toKeyPointList(messy), ["One", "Two", "Three"]);

console.log("--- Re-consent ---");
const current = [
  { slug: "terms-buyer" as const, title: "Terms", version: 2 },
  { slug: "privacy" as const, title: "Privacy", version: 1 },
];
const agreed = (terms: number, privacy: number) => ({
  role: "buyer" as const,
  consents: [
    { document: "terms-buyer" as const, version: terms, acceptedAt: "2026-10-01T00:00:00.000Z" },
    { document: "privacy" as const, version: privacy, acceptedAt: "2026-10-01T00:00:00.000Z" },
  ],
});
check("agreed to current versions", needsConsent(agreed(2, 1), current), false);
check("terms changed since", needsConsent(agreed(1, 1), current), true);
check("never agreed", needsConsent({ role: "buyer", consents: [] }, current), true);

console.log("--- Sign-up form rules ---");
const valid = {
  name: "Juan Dela Cruz",
  email: "juan@example.com",
  phone: "09171234567",
  password: "a-long-password",
  barangay: "San Marcos",
  addressDetails: "Purok 3",
  location: { lat: 14.916, lng: 120.766 },
  acceptTerms: true,
  acceptPrivacy: true,
  confirmAge: true,
};
check("valid sign-up passes", registerSchema.safeParse(valid).success, true);
check("unticked Terms fails", registerSchema.safeParse({ ...valid, acceptTerms: false }).success, false);
check("unticked Privacy fails", registerSchema.safeParse({ ...valid, acceptPrivacy: false }).success, false);
check("unticked age fails", registerSchema.safeParse({ ...valid, confirmAge: false }).success, false);
check("no map pin fails", registerSchema.safeParse({ ...valid, location: undefined }).success, false);
check("short password fails", registerSchema.safeParse({ ...valid, password: "short" }).success, false);
check("no username is fine", registerSchema.safeParse({ ...valid, chatName: "" }).success, true);
check("username juan_23 ok", registerSchema.safeParse({ ...valid, chatName: "juan_23" }).success, true);
check("username with spaces fails", registerSchema.safeParse({ ...valid, chatName: "juan dela" }).success, false);
check("username 'DigiMall_Admin' fails (looks official)", registerSchema.safeParse({ ...valid, chatName: "DigiMall_Admin" }).success, false);
check("store sees username", buyerDisplayName({ chatName: "juan_23", name: "Juan Dela Cruz" }), "juan_23");
check("no username: store sees first name only", buyerDisplayName({ chatName: null, name: "Juan Dela Cruz" }), "Juan");

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
