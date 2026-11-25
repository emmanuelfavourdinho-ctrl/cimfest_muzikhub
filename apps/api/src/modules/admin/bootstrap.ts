import { writeAudit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';

export class BootstrapError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/**
 * Grants ADMIN to the FIRST administrator only. Server-side (CLI) — there is no HTTP route.
 * Refuses when any administrator already exists (further roles are assigned in the console),
 * and is a no-op when re-run for the account that is already the administrator.
 */
export async function grantInitialAdmin(email: string): Promise<{ changed: boolean; userId: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new BootstrapError('INVALID_EMAIL', 'Enter the email address of an existing account.');
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { email: normalized },
        select: { id: true, platformRole: true, emailVerified: true, status: true },
      });
      if (!user) throw new BootstrapError('NO_ACCOUNT', 'No account uses that email. Register in the app first.');
      if (!user.emailVerified) throw new BootstrapError('EMAIL_NOT_VERIFIED', 'That account has not verified its email address yet.');
      if (user.status !== 'ACTIVE') throw new BootstrapError('NOT_ACTIVE', 'That account is not active.');

      const admins = await tx.user.findMany({ where: { platformRole: 'ADMIN' }, select: { id: true } });
      if (admins.some((a) => a.id === user.id)) return { changed: false, userId: user.id };
      if (admins.length > 0) {
        throw new BootstrapError('ADMIN_EXISTS', 'An administrator already exists. Assign further roles from the Admin Console.');
      }

      await tx.user.update({ where: { id: user.id }, data: { platformRole: 'ADMIN' } });
      await writeAudit(tx, {
        actor: { label: 'cli:admin:grant-initial' },
        action: 'user.role.grant_initial',
        target: { type: 'USER', id: user.id },
        reason: 'Initial administrator granted from the server command line',
        before: { role: user.platformRole },
        after: { role: 'ADMIN' },
      });
      return { changed: true, userId: user.id };
    },
    // Serializable: two concurrent runs can't both create "the first" administrator.
    { isolationLevel: 'Serializable' },
  );
}

/**
 * Last-resort recovery when a staff member has lost both their authenticator and their backup
 * codes and no other administrator can reset it from the console. Server-side only; audited.
 */
export async function resetTwoFactorFromCli(email: string, reason: string): Promise<{ userId: string }> {
  const normalized = email.trim().toLowerCase();
  if (reason.trim().length < 5) throw new BootstrapError('REASON_REQUIRED', 'Give a reason (at least 5 characters).');
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: normalized }, select: { id: true, twoFactorEnabled: true } });
    if (!user) throw new BootstrapError('NO_ACCOUNT', 'No account uses that email.');
    if (!user.twoFactorEnabled) throw new BootstrapError('NO_CHANGE', 'Two-factor authentication is not enabled for that account.');
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    const revokedSessions = (await tx.session.deleteMany({ where: { userId: user.id } })).count;
    await writeAudit(tx, {
      actor: { label: 'cli:admin:reset-two-factor' },
      action: 'user.two_factor.reset',
      target: { type: 'USER', id: user.id },
      reason: reason.trim(),
      before: { twoFactorEnabled: true },
      after: { twoFactorEnabled: false, revokedSessions },
    });
    return { userId: user.id };
  });
}
