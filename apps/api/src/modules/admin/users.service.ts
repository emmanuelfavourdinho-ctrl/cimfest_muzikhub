import { z } from 'zod';
import {
  adminUsersQuerySchema,
  can,
  ROLE_RANK,
  SUSPENSION_MAX_DAYS,
  type PlatformRole,
  type SetAccountStatusInput,
} from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { reinstateExpiredSuspensions } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { assertCan, assertFreshSession, type StaffContext } from '../../middleware/require-staff.js';
import { toMediaView } from '../media/media.service.js';

type UsersQuery = z.output<typeof adminUsersQuerySchema>;
const DAY = 24 * 60 * 60 * 1000;

const actorOf = (staff: StaffContext) => ({ id: staff.id, role: staff.role, ip: staff.ip });
const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });

function avatarOf(profile: { avatarAsset: Parameters<typeof toMediaView>[0] | null } | null) {
  return profile?.avatarAsset ? (toMediaView(profile.avatarAsset).urls.square ?? null) : null;
}

/** Loads the target and enforces "you can only act on accounts below your own role". */
async function loadTarget(staff: StaffContext, targetId: string, db: Prisma.TransactionClient = prisma) {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      platformRole: true,
      status: true,
      statusReason: true,
      statusUntil: true,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  if (target.id === staff.id) throw new HttpError(400, 'CANNOT_ACT_ON_SELF', "You can't change your own account from the Admin Console");
  if (ROLE_RANK[target.platformRole as PlatformRole] >= ROLE_RANK[staff.role]) {
    throw new HttpError(403, 'FORBIDDEN_TARGET', "You can't act on staff with the same or a higher role");
  }
  return target;
}

export async function listUsers(staff: StaffContext, query: UsersQuery) {
  await reinstateExpiredSuspensions();
  const privateAccess = can(staff.role, 'users.viewPrivate');
  const where: Prisma.UserWhereInput = {
    ...(query.status && { status: query.status }),
    ...(query.role && { platformRole: query.role }),
    ...(query.creativeRole && { profile: { is: { roles: { has: query.creativeRole } } } }),
    ...(query.q && {
      OR: [
        { name: contains(query.q) },
        { username: contains(query.q) },
        // Email search only for roles allowed to see email addresses.
        ...(privateAccess ? [{ email: contains(query.q) }] : []),
      ],
    }),
  };
  const page = await paginate(query, (args) =>
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        emailVerified: true,
        platformRole: true,
        status: true,
        statusUntil: true,
        twoFactorEnabled: true,
        createdAt: true,
        profile: { select: { roles: true, avatarAsset: true } },
      },
      ...args,
    }),
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      image: avatarOf(u.profile),
      email: privateAccess ? u.email : null,
      emailVerified: u.emailVerified,
      role: u.platformRole,
      status: u.status,
      statusUntil: u.statusUntil?.toISOString() ?? null,
      twoFactorEnabled: u.twoFactorEnabled,
      creativeRoles: u.profile?.roles ?? [],
      joinedAt: u.createdAt.toISOString(),
    })),
  };
}

export async function getUser(staff: StaffContext, userId: string) {
  await reinstateExpiredSuspensions(userId);
  const privateAccess = can(staff.role, 'users.viewPrivate');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: { include: { avatarAsset: true } } },
  });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');

  const [posts, comments, portfolio, published, reportsFiled, lastSession, postIds, commentIds, portfolioIds] = await Promise.all([
    prisma.post.count({ where: { authorId: userId } }),
    prisma.comment.count({ where: { authorId: userId } }),
    prisma.portfolioItem.count({ where: { ownerId: userId } }),
    prisma.portfolioItem.count({ where: { ownerId: userId, status: 'PUBLISHED' } }),
    prisma.report.count({ where: { reporterId: userId } }),
    prisma.session.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.post.findMany({ where: { authorId: userId }, select: { id: true } }),
    prisma.comment.findMany({ where: { authorId: userId }, select: { id: true } }),
    prisma.portfolioItem.findMany({ where: { ownerId: userId }, select: { id: true } }),
  ]);
  const reportsAgainst = await prisma.report.findMany({
    where: {
      OR: [
        { targetType: 'PROFILE', targetId: userId },
        { targetType: 'POST', targetId: { in: postIds.map((p) => p.id) } },
        { targetType: 'COMMENT', targetId: { in: commentIds.map((c) => c.id) } },
        { targetType: 'PORTFOLIO_ITEM', targetId: { in: portfolioIds.map((p) => p.id) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true },
  });
  const history = await prisma.auditLog.findMany({
    where: { targetType: 'USER', targetId: userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    image: avatarOf(user.profile),
    hasCover: Boolean(user.profile?.coverAssetId),
    isOrganiser: user.isOrganiser,
    email: privateAccess ? user.email : null,
    emailVerified: user.emailVerified,
    role: user.platformRole,
    status: user.status,
    statusReason: user.statusReason,
    statusUntil: user.statusUntil?.toISOString() ?? null,
    statusChangedAt: user.statusChangedAt?.toISOString() ?? null,
    twoFactorEnabled: user.twoFactorEnabled,
    primaryUse: user.primaryUse,
    creativeRoles: user.profile?.roles ?? [],
    location: user.profile?.location ?? null,
    bio: user.profile?.bio ?? null,
    joinedAt: user.createdAt.toISOString(),
    lastActiveAt: lastSession?.updatedAt.toISOString() ?? null,
    activity: { posts, comments, portfolioItems: portfolio, publishedWork: published, reportsFiled },
    reportsAgainst: reportsAgainst.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    history: history.map(toAuditView),
    /** What the viewing staff member may do to this account (for the UI; the API re-checks). */
    allowed: allowedActions(staff, user),
  };
}

function allowedActions(staff: StaffContext, target: { id: string; platformRole: string; status: string }) {
  const actable = target.id !== staff.id && ROLE_RANK[target.platformRole as PlatformRole] < ROLE_RANK[staff.role];
  return {
    restrict: actable && can(staff.role, 'users.restrict') && target.status !== 'RESTRICTED' && target.status !== 'BANNED',
    suspend: actable && can(staff.role, 'users.suspend') && target.status !== 'BANNED',
    ban: actable && can(staff.role, 'users.ban') && target.status !== 'BANNED',
    reinstate:
      actable &&
      target.status !== 'ACTIVE' &&
      (target.status === 'BANNED' ? can(staff.role, 'users.reinstateBanned') : can(staff.role, 'users.restrict')),
    changeRole: target.id !== staff.id && can(staff.role, 'roles.assign'),
    resetTwoFactor: target.id !== staff.id && can(staff.role, 'staff.resetTwoFactor'),
    grantOrganiser: target.id !== staff.id && can(staff.role, 'organisers.grant'),
    maxSuspensionDays: SUSPENSION_MAX_DAYS[staff.role],
  };
}

export async function setAccountStatus(staff: StaffContext, targetId: string, input: SetAccountStatusInput) {
  return prisma.$transaction(async (tx) => {
    const target = await loadTarget(staff, targetId, tx);
    if (target.status === input.status && input.status !== 'SUSPENDED') {
      throw new HttpError(409, 'NO_CHANGE', `This account is already ${input.status.toLowerCase()}`);
    }
    if (target.status === 'DEACTIVATED') throw new HttpError(409, 'ACCOUNT_DEACTIVATED', 'Deactivated accounts are managed by their owner');

    // Permission per transition (approved matrix).
    switch (input.status) {
      case 'RESTRICTED':
        assertCan(staff, 'users.restrict');
        break;
      case 'SUSPENDED': {
        assertCan(staff, 'users.suspend');
        const maxDays = SUSPENSION_MAX_DAYS[staff.role];
        if (new Date(input.until!).getTime() - Date.now() > maxDays * DAY + 60_000) {
          throw new HttpError(400, 'SUSPENSION_TOO_LONG', `Your role can suspend for at most ${maxDays} days`);
        }
        break;
      }
      case 'BANNED':
        assertCan(staff, 'users.ban');
        assertFreshSession(staff);
        break;
      case 'ACTIVE':
        if (target.status === 'BANNED') {
          assertCan(staff, 'users.reinstateBanned');
          assertFreshSession(staff);
        } else assertCan(staff, 'users.restrict');
        break;
    }
    if (target.status === 'BANNED' && input.status !== 'ACTIVE') {
      throw new HttpError(409, 'BANNED', 'A banned account must be reinstated before any other change');
    }

    const after = {
      status: input.status,
      statusReason: input.status === 'ACTIVE' ? null : input.reason,
      statusUntil: input.status === 'SUSPENDED' ? new Date(input.until!) : null,
      statusChangedAt: new Date(),
    };
    await tx.user.update({ where: { id: target.id }, data: after });
    // Suspension and bans take effect immediately: every existing session is revoked.
    let revokedSessions = 0;
    if (input.status === 'SUSPENDED' || input.status === 'BANNED') {
      revokedSessions = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
    }
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: input.status === 'ACTIVE' ? 'user.status.reinstate' : `user.status.${input.status.toLowerCase()}`,
      target: { type: 'USER', id: target.id },
      reason: input.reason,
      before: { status: target.status, statusReason: target.statusReason, statusUntil: target.statusUntil?.toISOString() ?? null },
      after: {
        status: after.status,
        statusReason: after.statusReason,
        statusUntil: after.statusUntil?.toISOString() ?? null,
        revokedSessions,
      },
    });
    return { status: after.status, statusUntil: after.statusUntil?.toISOString() ?? null, revokedSessions };
  });
}

export async function setRole(staff: StaffContext, targetId: string, role: PlatformRole, reason: string) {
  assertCan(staff, 'roles.assign');
  assertFreshSession(staff);
  if (targetId === staff.id) throw new HttpError(400, 'CANNOT_ACT_ON_SELF', "You can't change your own role");
  return prisma.$transaction(
    async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, platformRole: true, status: true, emailVerified: true },
      });
      if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
      if (target.platformRole === role) throw new HttpError(409, 'NO_CHANGE', `This account is already ${role.toLowerCase()}`);
      if (role !== 'USER' && (target.status !== 'ACTIVE' || !target.emailVerified)) {
        throw new HttpError(409, 'NOT_ELIGIBLE', 'Only active accounts with a verified email can become staff');
      }
      if (target.platformRole === 'ADMIN') {
        // At least one full administrator must always remain.
        const otherAdmins = await tx.user.count({ where: { platformRole: 'ADMIN', status: 'ACTIVE', id: { not: target.id } } });
        if (otherAdmins === 0) throw new HttpError(409, 'LAST_ADMIN', 'At least one administrator must remain');
      }
      await tx.user.update({ where: { id: target.id }, data: { platformRole: role } });
      await writeAudit(tx, {
        actor: actorOf(staff),
        action: 'user.role.change',
        target: { type: 'USER', id: target.id },
        reason,
        before: { role: target.platformRole },
        after: { role },
      });
      return { role };
    },
    // Serializable: two admins demoting each other at once can't leave zero admins.
    { isolationLevel: 'Serializable' },
  );
}

/** Staff recovery when an authenticator is lost: the person must enrol again before regaining access. */
export async function resetTwoFactor(staff: StaffContext, targetId: string, reason: string) {
  assertCan(staff, 'staff.resetTwoFactor');
  assertFreshSession(staff);
  if (targetId === staff.id) throw new HttpError(400, 'CANNOT_ACT_ON_SELF', 'Reset your own two-factor from your account settings');
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, twoFactorEnabled: true } });
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    if (!target.twoFactorEnabled) throw new HttpError(409, 'NO_CHANGE', 'Two-factor authentication is not enabled for this account');
    await tx.twoFactor.deleteMany({ where: { userId: target.id } });
    await tx.user.update({ where: { id: target.id }, data: { twoFactorEnabled: false } });
    const revokedSessions = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: 'user.two_factor.reset',
      target: { type: 'USER', id: target.id },
      reason,
      before: { twoFactorEnabled: true },
      after: { twoFactorEnabled: false, revokedSessions },
    });
    return { twoFactorEnabled: false, revokedSessions };
  });
}

export function toAuditView(a: Prisma.AuditLogGetPayload<object>) {
  return {
    id: a.id,
    actorId: a.actorId,
    actorRole: a.actorRole,
    actorLabel: a.actorLabel,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    reason: a.reason,
    before: a.before,
    after: a.after,
    createdAt: a.createdAt.toISOString(),
  };
}
