import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

// Super-admin hardening (suggestions/super-admin login hardening.txt):
// TOTP 2FA (authenticator app) + one-time backup codes + a hidden login page.

const TOTP_PERIOD_SECONDS = 30;
export const BACKUP_CODE_COUNT = 10;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const SETUP_TICKET_MINUTES = 10;

// One key per purpose, derived from PAYLOAD_SECRET, so the raw secret is never reused directly
const derivedKey = (purpose: string): Buffer => {
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("PAYLOAD_SECRET is missing");
  return createHash("sha256").update(`digimall:${purpose}:${secret}`).digest();
};

// --- Encrypting the 2FA secret at rest (AES-256-GCM) ---

export const encryptSecret = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("2fa-secret"), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
};

export const decryptSecret = (stored: string): string => {
  const [iv, tag, data] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) throw new Error("Bad encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey("2fa-secret"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};

// --- TOTP (the 6-digit codes) ---

export const newTotpSecret = (): string => new OTPAuth.Secret({ size: 20 }).base32;

const totpFor = (secretBase32: string, label: string) =>
  new OTPAuth.TOTP({
    issuer: "DigiMall",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

// Returns the time step the code belongs to, or null if wrong. Allows ±1 step for clock drift.
// The caller rejects steps <= the last used one, so each code works only once (no replay).
export const checkTotp = (secretBase32: string, code: string, now = Date.now()): number | null => {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const delta = totpFor(secretBase32, "check").validate({ token: clean, timestamp: now, window: 1 });
  if (delta === null) return null;
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS) + delta;
};

export const setupQrCode = async (secretBase32: string, email: string) => {
  const uri = totpFor(secretBase32, email).toString();
  return { qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }), uri };
};

// --- Backup codes (shown once, stored only as hashes) ---

const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

const normalizeBackupCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

export const hashBackupCode = (code: string): string =>
  createHmac("sha256", derivedKey("backup-codes")).update(normalizeBackupCode(code)).digest("hex");

export const newBackupCodes = (): string[] =>
  Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (byte) => BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

// Index of the matching (unused) backup code hash, or -1
export const findBackupCode = (hashes: string[], code: string): number => {
  if (normalizeBackupCode(code).length !== 10) return -1;
  const candidate = hashBackupCode(code);
  return hashes.findIndex((hash) => safeEqual(hash, candidate));
};

// --- Setup ticket: proves the password was right in step 1 of first-time 2FA setup ---

export const signSetupTicket = (userId: string, now = Date.now()): string => {
  const body = Buffer.from(JSON.stringify({ uid: userId, exp: now + SETUP_TICKET_MINUTES * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", derivedKey("setup-ticket")).update(body).digest("base64url");
  return `${body}.${signature}`;
};

export const readSetupTicket = (ticket: string, now = Date.now()): string | null => {
  const [body, signature] = ticket.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", derivedKey("setup-ticket")).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid?: string; exp?: number };
    return uid && exp && exp > now ? uid : null;
  } catch {
    return null;
  }
};

// --- The hidden entry path (ADMIN_ENTRY_PATH) ---

const MIN_ENTRY_KEY_LENGTH = 16;

// True only when the env var is set (and long enough) and the given key matches it exactly
export const isValidEntryKey = (key: string | null | undefined): boolean => {
  const expected = process.env.ADMIN_ENTRY_PATH ?? "";
  // Disabled when missing, too short, or still the placeholder from .env.example
  if (expected.length < MIN_ENTRY_KEY_LENGTH || expected.startsWith("change-me") || !key) return false;
  return safeEqual(createHash("sha256").update(key).digest("hex"), createHash("sha256").update(expected).digest("hex"));
};
