import { reportDescribers } from './moderation-registry.js';
import { z } from 'zod';
import { adminReportsQuerySchema, can } from '@muzikhub/shared';
import type { Prisma, Report } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { assertCan, type StaffContext } from '../../middleware/require-staff.js';
import { toMediaView } from '../media/media.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { toAuditView } from './users.service.js';

type ReportsQuery = z.output<typeof adminReportsQuerySchema>;
const OPEN = ['PENDING', 'UNDER_REVIEW'] as const;
const actorOf = (staff: StaffContext) => ({ id: staff.id, role: staff.role, ip: staff.ip });
const excerpt = (t: string | null | undefined, n = 200) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null);

/** What a report points at, resolved for display. Missing targets are reported honestly. */
async function describeTargets(reports: Pick<Report, 'targetType' | 'targetId'>[]) {
  const ids = (type: string) => [...new Set(reports.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const [posts, comments, items, users] = await Promise.all([
    prisma.post.findMany({
      where: { id: { in: ids('POST') } },
      include: { author: { select: { id: true, ...personSelect } }, media: { include: { asset: true }, orderBy: { position: 'asc' } } },
    }),
    prisma.comment.findMany({ where: { id: { in: ids('COMMENT') } }, include: { author: { select: { id: true, ...personSelect } } } }),
    prisma.portfolioItem.findMany({
      where: { id: { in: ids('PORTFOLIO_ITEM') } },
      include: { owner: { select: { id: true, ...personSelect } }, coverAsset: true, mediaAsset: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ids('PROFILE') } },
      select: {
        ...personSelect,
        id: true,
        status: true,
        profile: { select: { bio: true, avatarAssetId: true, coverAssetId: true, avatarAsset: true } },
      },
    }),
  ]);
  const map = new Map<string, Record<string, unknown>>();
  for (const p of posts) {
    map.set(`POST:${p.id}`, {
      exists: true,
      removed: Boolean(p.removedAt),
      removalReason: p.removalReason,
      ownerId: p.author.id,
      owner: toPerson(p.author),
      title: p.type === 'SHOWCASE' ? 'Shared portfolio work' : `${p.type.toLowerCase()} post`,
      text: excerpt(p.body),
      media: p.media.map((m) => toMediaView(m.asset)),
      link: `/p/${p.id}`,
      moderationType: 'post',
    });
  }
  for (const c of comments) {
    map.set(`COMMENT:${c.id}`, {
      exists: true,
      removed: Boolean(c.removedAt),
      removalReason: c.removalReason,
      ownerId: c.author.id,
      owner: toPerson(c.author),
      title: 'Comment',
      text: excerpt(c.body),
      media: [],
      link: `/p/${c.postId}`,
      moderationType: 'comment',
    });
  }
  for (const i of items) {
    map.set(`PORTFOLIO_ITEM:${i.id}`, {
      exists: true,
      removed: Boolean(i.removedAt),
      removalReason: i.removalReason,
      ownerId: i.owner.id,
      owner: toPerson(i.owner),
      title: i.title,
      text: excerpt(i.description),
      media: [i.coverAsset, i.mediaAsset].filter(Boolean).map((a) => toMediaView(a!)),
      link: `/work/${i.id}`,
      moderationType: 'portfolio-item',
    });
  }
  for (const u of users) {
    map.set(`PROFILE:${u.id}`, {
      exists: true,
      removed: false,
      ownerId: u.id,
      owner: toPerson(u),
      accountStatus: u.status,
      title: `Profile of ${u.name}`,
      text: excerpt(u.profile?.bio),
      media: u.profile?.avatarAsset ? [toMediaView(u.profile.avatarAsset)] : [],
      hasAvatar: Boolean(u.profile?.avatarAssetId),
      hasCover: Boolean(u.profile?.coverAssetId),
      link: `/u/${u.username}`,
      moderationType: null,
    });
  }
  // Content types contributed by feature modules (communities, competitions, messages).
  for (const [type, describe] of reportDescribers()) {
    const found = await describe(ids(type));
    for (const [id, entry] of found) map.set(`${type}:${id}`, entry);
  }
  return (r: Pick<Report, 'targetType' | 'targetId'>) =>
    map.get(`${r.targetType}:${r.targetId}`) ?? { exists: false, title: 'Content no longer exists' };
}

async function peopleById(ids: (string | null)[]) {
  const list = await prisma.user.findMany({
    where: { id: { in: ids.filter((x): x is string => Boolean(x)) } },
    select: { id: true, ...personSelect },
  });
  return new Map(list.map((u) => [u.id, toPerson(u)]));
}

export async function listReports(staff: StaffContext, query: ReportsQuery) {
  assertCan(staff, 'reports.manage');
  const where: Prisma.ReportWhereInput = {
    ...(query.status && { status: query.status }),
    ...(query.open === 'true' && { status: { in: [...OPEN] } }),
    ...(query.targetType && { targetType: query.targetType }),
    ...(query.assigned === 'me' && { assigneeId: staff.id }),
    ...(query.assigned === 'unassigned' && { assigneeId: null }),
    ...(query.escalated && { escalated: query.escalated === 'true' }),
  };
  // Oldest open work first; closed reports newest first.
  const open = query.open === 'true' || query.status === 'PENDING' || query.status === 'UNDER_REVIEW';
  const page = await paginate(query, (args) =>
    prisma.report.findMany({
      where,
      orderBy: open ? [{ escalated: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { reporter: { select: personSelect }, _count: { select: { notes: true } } },
      ...args,
    }),
  );
  const describe = await describeTargets(page.items);
  const people = await peopleById(page.items.map((r) => r.assigneeId));
  const related = await prisma.report.groupBy({
    by: ['targetType', 'targetId'],
    where: { status: { in: [...OPEN] }, OR: page.items.map((r) => ({ targetType: r.targetType, targetId: r.targetId })) },
    _count: { _all: true },
  });
  const relatedCount = new Map(related.map((g) => [`${g.targetType}:${g.targetId}`, g._count._all]));
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((r) => ({
      ...reportView(r),
      reporter: toPerson(r.reporter),
      assignee: r.assigneeId ? (people.get(r.assigneeId) ?? null) : null,
      target: describe(r),
      notesCount: r._count.notes,
      openReportsOnTarget: relatedCount.get(`${r.targetType}:${r.targetId}`) ?? 0,
    })),
  };
}

function reportView(r: Report) {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    escalated: r.escalated,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

export async function getReport(staff: StaffContext, id: string) {
  assertCan(staff, 'reports.manage');
  const r = await prisma.report.findUnique({
    where: { id },
    include: { reporter: { select: personSelect }, notes: { orderBy: { createdAt: 'asc' } } },
  });
  if (!r) throw new HttpError(404, 'REPORT_NOT_FOUND', 'Report not found');
  const describe = await describeTargets([r]);
  const others = await prisma.report.findMany({
    where: { targetType: r.targetType, targetId: r.targetId, id: { not: r.id } },
    orderBy: { createdAt: 'desc' },
    include: { reporter: { select: personSelect } },
    take: 50,
  });
  const people = await peopleById([r.assigneeId, r.resolvedById, ...r.notes.map((n) => n.authorId)]);
  const history = await prisma.auditLog.findMany({ where: { targetType: 'REPORT', targetId: r.id }, orderBy: { createdAt: 'asc' } });
  return {
    ...reportView(r),
    reporter: toPerson(r.reporter),
    assignee: r.assigneeId ? (people.get(r.assigneeId) ?? null) : null,
    resolvedBy: r.resolvedById ? (people.get(r.resolvedById) ?? null) : null,
    target: describe(r),
    notes: r.notes.map((n) => ({ id: n.id, body: n.body, author: people.get(n.authorId) ?? null, createdAt: n.createdAt.toISOString() })),
    otherReports: others.map((o) => ({ ...reportView(o), reporter: toPerson(o.reporter) })),
    history: history.map(toAuditView),
    canDecide: !r.escalated || can(staff.role, 'reports.decideEscalated'),
  };
}

async function loadOpen(tx: Prisma.TransactionClient, id: string) {
  const r = await tx.report.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, 'REPORT_NOT_FOUND', 'Report not found');
  if (!(OPEN as readonly string[]).includes(r.status)) throw new HttpError(409, 'REPORT_CLOSED', 'This report is already closed');
  return r;
}

export async function assignReport(staff: StaffContext, id: string, assignee: 'me' | 'nobody') {
  assertCan(staff, 'reports.manage');
  return prisma.$transaction(async (tx) => {
    const r = await loadOpen(tx, id);
    const data =
      assignee === 'me' ? { assigneeId: staff.id, status: 'UNDER_REVIEW' as const } : { assigneeId: null, status: 'PENDING' as const };
    await tx.report.update({ where: { id }, data });
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: assignee === 'me' ? 'report.assign' : 'report.unassign',
      target: { type: 'REPORT', id },
      before: { status: r.status, assigneeId: r.assigneeId },
      after: data,
    });
    return data;
  });
}

export async function addNote(staff: StaffContext, id: string, body: string) {
  assertCan(staff, 'reports.manage');
  return prisma.$transaction(async (tx) => {
    const r = await tx.report.findUnique({ where: { id } });
    if (!r) throw new HttpError(404, 'REPORT_NOT_FOUND', 'Report not found');
    const note = await tx.reportNote.create({ data: { reportId: id, authorId: staff.id, body } });
    await writeAudit(tx, { actor: actorOf(staff), action: 'report.note', target: { type: 'REPORT', id }, after: { noteId: note.id } });
    return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
  });
}

export async function escalateReport(staff: StaffContext, id: string, reason: string) {
  assertCan(staff, 'reports.manage');
  return prisma.$transaction(async (tx) => {
    const r = await loadOpen(tx, id);
    if (r.escalated) throw new HttpError(409, 'NO_CHANGE', 'This report is already escalated');
    await tx.report.update({ where: { id }, data: { escalated: true, status: 'UNDER_REVIEW' } });
    await tx.reportNote.create({ data: { reportId: id, authorId: staff.id, body: `Escalated: ${reason}` } });
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: 'report.escalate',
      target: { type: 'REPORT', id },
      reason,
      before: { escalated: false, status: r.status },
      after: { escalated: true, status: 'UNDER_REVIEW' },
    });
    return { escalated: true };
  });
}

/** Resolve or dismiss. Escalated reports need an ADMIN. Optionally closes the other open reports on the same target. */
export async function closeReport(
  staff: StaffContext,
  id: string,
  outcome: 'RESOLVED' | 'DISMISSED',
  resolution: string,
  includeRelated: boolean,
) {
  assertCan(staff, 'reports.manage');
  return prisma.$transaction(async (tx) => {
    const r = await loadOpen(tx, id);
    const decideEscalated = can(staff.role, 'reports.decideEscalated');
    if (r.escalated && !decideEscalated) throw new HttpError(403, 'ESCALATED', 'Escalated reports are decided by an administrator');
    const targets = includeRelated
      ? await tx.report.findMany({
          where: {
            targetType: r.targetType,
            targetId: r.targetId,
            status: { in: [...OPEN] },
            ...(decideEscalated ? {} : { escalated: false }),
          },
        })
      : [r];
    const closedAt = new Date();
    for (const t of targets) {
      // Conditional: a report closed concurrently by someone else is left alone.
      const changed = await tx.report.updateMany({
        where: { id: t.id, status: { in: [...OPEN] } },
        data: { status: outcome, resolution, resolvedById: staff.id, resolvedAt: closedAt, assigneeId: t.assigneeId ?? staff.id },
      });
      if (changed.count === 0) continue;
      await writeAudit(tx, {
        actor: actorOf(staff),
        action: outcome === 'RESOLVED' ? 'report.resolve' : 'report.dismiss',
        target: { type: 'REPORT', id: t.id },
        reason: resolution,
        before: { status: t.status },
        after: { status: outcome, viaReport: t.id === r.id ? null : r.id },
      });
    }
    return { status: outcome, closed: targets.length };
  });
}
