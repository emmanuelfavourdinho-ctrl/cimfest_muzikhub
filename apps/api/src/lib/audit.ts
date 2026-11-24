import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

export interface AuditActor {
  id?: string | null;
  role?: string | null;
  /** For non-human actors, e.g. "cli:admin:grant-initial". */
  label?: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  /** Dotted verb, e.g. "user.status.change", "content.remove", "report.resolve". */
  action: string;
  target: { type: string; id: string };
  reason?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * Appends one audit record. Pass the transaction client so the audit row and the change it
 * describes commit (or fail) together. The table itself is append-only (database trigger).
 */
export async function writeAudit(db: Prisma.TransactionClient | typeof prisma, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actor.id ?? null,
      actorRole: entry.actor.role ?? null,
      actorLabel: entry.actor.label ?? null,
      ipAddress: entry.actor.ip ?? null,
      action: entry.action,
      targetType: entry.target.type,
      targetId: entry.target.id,
      reason: entry.reason ?? null,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  });
}
