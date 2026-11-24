import type { AccountStatus, Prisma } from '../generated/prisma/client.js';
import { writeAudit } from './audit.js';
import { prisma } from './prisma.js';

/**
 * Account states (approved 2026-11-24), enforced on the server:
 *
 * | status      | sign in | visible to others | publish / interact |
 * |-------------|---------|-------------------|--------------------|
 * | ACTIVE      | yes     | yes               | yes                |
 * | RESTRICTED  | yes     | yes               | no (read-only)     |
 * | SUSPENDED   | no*     | no                | no                 |  * until statusUntil passes
 * | BANNED      | no      | no                | no                 |
 * | DEACTIVATED | no      | no                | no                 |
 */
export const VISIBLE_STATUSES = ['ACTIVE', 'RESTRICTED'] as const satisfies readonly AccountStatus[];

/** Prisma filter for "a person other users may see" (authors, owners, profiles, discovery). */
export const visibleUser = { status: { in: [...VISIBLE_STATUSES] } } satisfies Prisma.UserWhereInput;

export function isVisibleStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (VISIBLE_STATUSES as readonly string[]).includes(status);
}

/** Only ACTIVE accounts may create or change content and interact with others. */
export function hasFullAccess(status: string | null | undefined): boolean {
  return status === 'ACTIVE';
}

/**
 * Reinstates suspensions whose expiry has passed and records it in the audit log.
 * Runs on sign-in for the user concerned, on a timer in the server, and before admin views.
 */
export async function reinstateExpiredSuspensions(userId?: string): Promise<number> {
  const expired = await prisma.user.findMany({
    where: { status: 'SUSPENDED', statusUntil: { lte: new Date() }, ...(userId && { id: userId }) },
    select: { id: true, status: true, statusReason: true, statusUntil: true },
  });
  for (const user of expired) {
    await prisma.$transaction(async (tx) => {
      // Conditional update: a concurrent admin change wins; we only reinstate if still expired.
      const changed = await tx.user.updateMany({
        where: { id: user.id, status: 'SUSPENDED', statusUntil: { lte: new Date() } },
        data: { status: 'ACTIVE', statusReason: null, statusUntil: null, statusChangedAt: new Date() },
      });
      if (changed.count === 0) return;
      await writeAudit(tx, {
        actor: { label: 'system:suspension-expiry' },
        action: 'user.status.expired',
        target: { type: 'USER', id: user.id },
        reason: 'Suspension period ended',
        before: { status: user.status, statusReason: user.statusReason, statusUntil: user.statusUntil },
        after: { status: 'ACTIVE' },
      });
    });
  }
  return expired.length;
}
