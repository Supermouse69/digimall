import type { PayloadRequest } from "payload";

import type { AuditAction } from "@/collections/AuditLogs";

type AuditEntry = {
  action: AuditAction;
  targetCollection?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

const clientIp = (req: PayloadRequest): string | undefined =>
  req.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers?.get("x-real-ip") || undefined;

// Writes one audit entry. Never throws: a logging hiccup must not break the user's action,
// but it is reported in the server log so it can be noticed.
// Uses the same request (and database transaction) as the action, so if the action is
// rolled back, its log entry is too — the log only records things that really happened.
export const writeAuditLog = async (req: PayloadRequest, entry: AuditEntry): Promise<void> => {
  try {
    await req.payload.create({
      collection: "audit-logs",
      overrideAccess: true,
      req,
      data: {
        action: entry.action,
        actor: req.user && req.user.collection === "users" ? req.user.id : undefined,
        targetCollection: entry.targetCollection,
        targetId: entry.targetId,
        details: entry.details,
        ip: clientIp(req),
      },
    });
  } catch (error) {
    req.payload.logger.error({ msg: "audit log write failed", action: entry.action, error });
  }
};
