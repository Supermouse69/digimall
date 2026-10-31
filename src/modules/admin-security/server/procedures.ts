import z from "zod";
import { TRPCError } from "@trpc/server";
import { headers as getHeaders } from "next/headers";
import type { Payload } from "payload";

import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import type { AuditAction } from "@/collections/AuditLogs";
import type { User } from "@/payload-types";
import { generateAuthCookie } from "@/modules/auth/utils";
import { clientIp } from "@/modules/bot-protection/server/client-ip";
import { guardPublicForm, guardRateLimit, humanCheckInput } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

import {
  checkTotp,
  decryptSecret,
  encryptSecret,
  findBackupCode,
  hashBackupCode,
  isValidEntryKey,
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  newBackupCodes,
  newTotpSecret,
  readSetupTicket,
  setupQrCode,
  signSetupTicket,
} from "./two-factor";

// One message for every failure, so nobody learns which part was wrong
const LOGIN_FAILED = "Wrong email, password, or code.";
const LOCKED = `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`;

type TwoFactor = {
  enabled?: boolean | null;
  secret?: string | null;
  pendingSecret?: string | null;
  backupCodeHashes?: string[] | null;
  lastUsedStep?: number | null;
  failedAttempts?: number | null;
  lockedUntil?: string | null;
};
type AdminUser = User & { twoFactor?: TwoFactor };

const entryKey = z.string().min(1).max(200);
const credentials = {
  key: entryKey,
  email: z.email().max(254),
  password: z.string().min(1).max(128),
};

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Not found" });
const failed = () => new TRPCError({ code: "UNAUTHORIZED", message: LOGIN_FAILED });

const findUserByEmail = async (payload: Payload, email: string) => {
  const { docs } = await payload.find({
    collection: "users",
    where: { email: { equals: email.trim().toLowerCase() } },
    limit: 1,
    depth: 0,
    showHiddenFields: true,
    overrideAccess: true,
  });
  return docs[0] as AdminUser | undefined;
};

const setTwoFactor = (payload: Payload, userId: string, twoFactor: TwoFactor) =>
  payload.update({ collection: "users", id: userId, data: { twoFactor } as never, overrideAccess: true });

const audit = async (payload: Payload, action: AuditAction, actorId?: string, details?: Record<string, unknown>) => {
  const headers = await getHeaders();
  await payload.create({
    collection: "audit-logs",
    overrideAccess: true,
    data: {
      action,
      actor: actorId,
      targetCollection: "users",
      targetId: actorId,
      details,
      ip: clientIp(headers),
    },
  });
};

const recordFailure = async (payload: Payload, user: AdminUser, reason: string) => {
  const attempts = (user.twoFactor?.failedAttempts ?? 0) + 1;
  await setTwoFactor(payload, user.id, {
    ...user.twoFactor,
    failedAttempts: attempts,
    lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
  });
  await audit(payload, "admin.login_failed", user.id, { reason, attempts });
};

const isLocked = (user: AdminUser) =>
  Boolean(user.twoFactor?.lockedUntil && Date.parse(user.twoFactor.lockedUntil) > Date.now());

// Password check through Payload (counts wrong passwords + locks the account on its own).
// The adminEntry flag is the only way past the "super-admins can't log in" rule.
const passwordLogin = async (payload: Payload, email: string, password: string) => {
  try {
    const result = await payload.login({
      collection: "users",
      data: { email, password },
      context: { adminEntry: true },
    });
    return result.token ?? null;
  } catch {
    return null;
  }
};

export const adminEntryRouter = createTRPCRouter({
  // Step 1 (every login). If 2FA isn't set up yet, returns the QR code to set it up instead.
  login: baseProcedure
    .input(z.object({ ...credentials, ...humanCheckInput, code: z.string().max(20).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!isValidEntryKey(input.key)) throw notFound();
      await guardPublicForm(ctx.db, { turnstileToken: input.turnstileToken, limits: [{ rule: RATE_LIMITS.adminLogin }] });

      const user = await findUserByEmail(ctx.db, input.email);
      if (!user || user.role !== "super-admin") throw failed();
      if (isLocked(user)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: LOCKED });

      const twoFactor = user.twoFactor ?? {};

      // 2FA already on: the code (or a backup code) must be right BEFORE we even check the password
      let usedStep: number | null = null;
      let usedBackupIndex = -1;
      if (twoFactor.enabled && twoFactor.secret) {
        const code = input.code?.trim() ?? "";
        usedStep = checkTotp(decryptSecret(twoFactor.secret), code);
        if (usedStep !== null && usedStep <= (twoFactor.lastUsedStep ?? -1)) usedStep = null; // already used
        if (usedStep === null) usedBackupIndex = findBackupCode(twoFactor.backupCodeHashes ?? [], code);
        if (usedStep === null && usedBackupIndex === -1) {
          await recordFailure(ctx.db, user, "bad code");
          throw failed();
        }
      }

      const token = await passwordLogin(ctx.db, input.email, input.password);
      if (!token) {
        await recordFailure(ctx.db, user, "bad password");
        throw failed();
      }

      // First time: no session yet. Show the QR code; step 2 (confirmSetup) finishes the login.
      if (!twoFactor.enabled || !twoFactor.secret) {
        const secret = newTotpSecret();
        await setTwoFactor(ctx.db, user.id, { ...twoFactor, pendingSecret: encryptSecret(secret), failedAttempts: 0 });
        const { qrDataUrl } = await setupQrCode(secret, user.email);
        return {
          status: "setup_required" as const,
          ticket: signSetupTicket(user.id),
          qrDataUrl,
          manualKey: secret,
        };
      }

      const backupCodeHashes = [...(twoFactor.backupCodeHashes ?? [])];
      if (usedBackupIndex >= 0) backupCodeHashes.splice(usedBackupIndex, 1); // each backup code works once
      await setTwoFactor(ctx.db, user.id, {
        ...twoFactor,
        backupCodeHashes,
        lastUsedStep: usedStep ?? twoFactor.lastUsedStep,
        failedAttempts: 0,
        lockedUntil: null,
      });
      await generateAuthCookie({ prefix: ctx.db.config.cookiePrefix, value: token });
      await audit(ctx.db, "admin.login", user.id, {
        method: usedBackupIndex >= 0 ? "backup_code" : "authenticator",
        backupCodesLeft: backupCodeHashes.length,
      });
      return { status: "logged_in" as const, redirectTo: "/admin", backupCodesLeft: backupCodeHashes.length };
    }),

  // Step 2 (first time only): the code from the newly scanned QR proves the app is set up
  confirmSetup: baseProcedure
    .input(z.object({ ...credentials, ticket: z.string().min(10).max(500), code: z.string().max(20) }))
    .mutation(async ({ ctx, input }) => {
      if (!isValidEntryKey(input.key)) throw notFound();
      // No robot check here: this step needs the signed ticket from step 1, which already had one
      await guardRateLimit(ctx.db, RATE_LIMITS.adminLogin);

      const user = await findUserByEmail(ctx.db, input.email);
      const ticketUser = readSetupTicket(input.ticket);
      if (!user || user.role !== "super-admin" || ticketUser !== user.id) throw failed();
      if (isLocked(user)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: LOCKED });

      const pending = user.twoFactor?.pendingSecret;
      if (!pending) throw failed();
      const secret = decryptSecret(pending);
      const step = checkTotp(secret, input.code);
      if (step === null) {
        await recordFailure(ctx.db, user, "bad setup code");
        throw failed();
      }

      const token = await passwordLogin(ctx.db, input.email, input.password);
      if (!token) {
        await recordFailure(ctx.db, user, "bad password");
        throw failed();
      }

      const backupCodes = newBackupCodes();
      await setTwoFactor(ctx.db, user.id, {
        enabled: true,
        secret: encryptSecret(secret),
        pendingSecret: null,
        backupCodeHashes: backupCodes.map(hashBackupCode),
        lastUsedStep: step,
        failedAttempts: 0,
        lockedUntil: null,
      });
      await generateAuthCookie({ prefix: ctx.db.config.cookiePrefix, value: token });
      await audit(ctx.db, "admin.2fa_enabled", user.id);
      await audit(ctx.db, "admin.login", user.id, { method: "first_setup" });

      // Shown ONCE. Only their hashes are stored.
      return { status: "logged_in" as const, redirectTo: "/admin", backupCodes };
    }),
});
