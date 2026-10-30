// Run: bun run test:2fa
// Super-admin 2FA building blocks (no database needed).
export {};
process.env.PAYLOAD_SECRET ??= "test-only-secret";

const OTPAuth = await import("otpauth");
const tf = await import("../src/modules/admin-security/server/two-factor");

let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || info === undefined ? "" : `  ->  ${JSON.stringify(info)}`}`);
};

console.log("--- Secret encrypted at rest ---");
const secret = tf.newTotpSecret();
const stored = tf.encryptSecret(secret);
check("decrypts back to the same secret", tf.decryptSecret(stored) === secret);
check("stored value doesn't contain the secret", !stored.includes(secret));
check("two encryptions differ (random IV)", tf.encryptSecret(secret) !== stored);
const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
check("tampered value is rejected", (() => { try { tf.decryptSecret(tampered); return false; } catch { return true; } })());

console.log("--- 6-digit codes ---");
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
const now = Date.now();
const goodCode = totp.generate({ timestamp: now });
const step = tf.checkTotp(secret, goodCode, now);
check("current code is accepted", step !== null);
check("code from 30s ago still OK (clock drift)", tf.checkTotp(secret, totp.generate({ timestamp: now - 30_000 }), now) !== null);
check("code from 5 min ago is refused", tf.checkTotp(secret, totp.generate({ timestamp: now - 300_000 }), now) === null);
check("wrong code is refused", tf.checkTotp(secret, goodCode === "123456" ? "654321" : "123456", now) === null);
check("letters are refused", tf.checkTotp(secret, "12a456", now) === null);
check("another secret's code is refused", tf.checkTotp(tf.newTotpSecret(), goodCode, now) === null);

console.log("--- Backup codes ---");
const codes = tf.newBackupCodes();
const hashes = codes.map(tf.hashBackupCode);
check("10 codes", codes.length === 10);
check("all different", new Set(codes).size === 10);
check("format xxxxx-xxxxx, no confusing characters", codes.every((c) => /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/.test(c)), codes[0]);
check("hash doesn't contain the code", !hashes[0]!.includes(codes[0]!.replace("-", "")));
check("a real code is found", tf.findBackupCode(hashes, codes[3]!) === 3);
check("typed in CAPS without the dash still works", tf.findBackupCode(hashes, codes[3]!.toUpperCase().replace("-", "")) === 3);
check("an unknown code is refused", tf.findBackupCode(hashes, "aaaaa-bbbbb") === -1);
check("a used (removed) code is refused", tf.findBackupCode(hashes.filter((_, i) => i !== 3), codes[3]!) === -1);

console.log("--- Setup ticket (proves step 1 passed) ---");
const ticket = tf.signSetupTicket("user-1", now);
check("valid ticket -> user id", tf.readSetupTicket(ticket, now) === "user-1");
check("expired after 10 minutes", tf.readSetupTicket(ticket, now + 11 * 60_000) === null);
const [body, sig] = ticket.split(".");
const forgedBody = Buffer.from(JSON.stringify({ uid: "attacker", exp: now + 60_000 })).toString("base64url");
check("edited ticket is refused", tf.readSetupTicket(`${forgedBody}.${sig}`, now) === null);
check("garbage is refused", tf.readSetupTicket("not-a-ticket", now) === null && tf.readSetupTicket(`${body}.`, now) === null);

console.log("--- Hidden entry key ---");
process.env.ADMIN_ENTRY_PATH = "a-long-random-entry-key-1234";
check("right key opens", tf.isValidEntryKey("a-long-random-entry-key-1234"));
check("wrong key = 404", !tf.isValidEntryKey("a-long-random-entry-key-1235"));
check("empty key = 404", !tf.isValidEntryKey(""));
process.env.ADMIN_ENTRY_PATH = "short";
check("too-short env value disables the page", !tf.isValidEntryKey("short"));
process.env.ADMIN_ENTRY_PATH = "change-me-to-a-long-random-value";
check(".env.example placeholder disables the page", !tf.isValidEntryKey("change-me-to-a-long-random-value"));
delete process.env.ADMIN_ENTRY_PATH;
check("missing env var disables the page", !tf.isValidEntryKey("anything-at-all-here"));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
