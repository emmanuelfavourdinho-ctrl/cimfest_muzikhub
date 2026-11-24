import { can } from '@muzikhub/shared';
import { reinstateExpiredSuspensions } from '../../lib/account-status.js';
import { prisma } from '../../lib/prisma.js';
import { assertCan, type StaffContext } from '../../middleware/require-staff.js';
import { toAuditView } from './users.service.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Operational overview. Every number is a live database query — nothing is estimated or
 * sampled. Pillars that don't exist yet are reported as "not built", never as zero.
 */
export async function overview(staff: StaffContext) {
  assertCan(staff, 'overview.view');
  await reinstateExpiredSuspensions();
  const now = Date.now();
  const since = (days: number) => new Date(now - days * DAY);

  const [
    total,
    byStatus,
    new7,
    new30,
    activeSessions,
    weekly,
    posts,
    posts7,
    comments7,
    works,
    removed30,
    openReports,
    unassigned,
    escalated,
    oldestOpen,
    closed7,
    staff2fa,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
    prisma.user.count({ where: { createdAt: { gte: since(30) } } }),
    // "Active" = a session was used or refreshed in the last 7 days (Better Auth updates it on use).
    prisma.session.findMany({ where: { updatedAt: { gte: since(7) } }, distinct: ['userId'], select: { userId: true } }),
    prisma.$queryRaw<{ week: Date; count: bigint }[]>`
        SELECT date_trunc('week', "createdAt") AS week, count(*)::bigint AS count
        FROM "user" WHERE "createdAt" >= now() - interval '12 weeks'
        GROUP BY 1 ORDER BY 1`,
    prisma.post.count({ where: { removedAt: null } }),
    prisma.post.count({ where: { removedAt: null, createdAt: { gte: since(7) } } }),
    prisma.comment.count({ where: { removedAt: null, createdAt: { gte: since(7) } } }),
    prisma.portfolioItem.count({ where: { status: 'PUBLISHED', visibility: 'PUBLIC', removedAt: null } }),
    prisma.auditLog.count({ where: { action: 'content.remove', createdAt: { gte: since(30) } } }),
    prisma.report.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
    prisma.report.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] }, assigneeId: null } }),
    prisma.report.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] }, escalated: true } }),
    prisma.report.findFirst({
      where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.report.count({ where: { status: { in: ['RESOLVED', 'DISMISSED'] }, resolvedAt: { gte: since(7) } } }),
    prisma.user.groupBy({
      by: ['platformRole', 'twoFactorEnabled'],
      where: { platformRole: { in: ['MODERATOR', 'ADMIN'] } },
      _count: { _all: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const staffCount = (role: string) => staff2fa.filter((s) => s.platformRole === role).reduce((n, s) => n + s._count._all, 0);

  // Fill missing weeks with 0 so the trend is honest about quiet weeks.
  const weeks: { weekStart: string; signups: number }[] = [];
  const byWeek = new Map(weekly.map((w) => [new Date(w.week).toISOString().slice(0, 10), Number(w.count)]));
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday (date_trunc week = ISO Monday)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 7 * DAY).toISOString().slice(0, 10);
    weeks.push({ weekStart: d, signups: byWeek.get(d) ?? 0 });
  }

  const recentAudit = can(staff.role, 'audit.view')
    ? (await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })).map(toAuditView)
    : null;

  return {
    generatedAt: new Date(now).toISOString(),
    users: {
      total,
      new7d: new7,
      new30d: new30,
      active7d: activeSessions.length,
      byStatus: {
        ACTIVE: statusCounts.ACTIVE ?? 0,
        RESTRICTED: statusCounts.RESTRICTED ?? 0,
        SUSPENDED: statusCounts.SUSPENDED ?? 0,
        BANNED: statusCounts.BANNED ?? 0,
        DEACTIVATED: statusCounts.DEACTIVATED ?? 0,
      },
      weeklySignups: weeks,
    },
    content: { posts, posts7d: posts7, comments7d: comments7, publishedWork: works, removed30d: removed30 },
    moderation: {
      openReports,
      unassigned,
      escalated,
      oldestOpenAt: oldestOpen?.createdAt.toISOString() ?? null,
      closed7d: closed7,
    },
    staff: {
      admins: staffCount('ADMIN'),
      moderators: staffCount('MODERATOR'),
      withoutTwoFactor: staff2fa.filter((s) => !s.twoFactorEnabled).reduce((n, s) => n + s._count._all, 0),
    },
    /** Pillars that don't exist yet — shown as "not built", never as zero. */
    pending: ['opportunities', 'announcements'],
    recentAudit,
  };
}
