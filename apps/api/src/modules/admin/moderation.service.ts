import { z } from 'zod';
import { adminContentQuerySchema, ROLE_RANK, type ModerationTarget, type PlatformRole } from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { assertCan, type StaffContext } from '../../middleware/require-staff.js';
import { releaseAssets, toMediaView } from '../media/media.service.js';
import { personSelect, toPerson } from '../profiles/people.js';

type ContentQuery = z.output<typeof adminContentQuerySchema>;
const actorOf = (staff: StaffContext) => ({ id: staff.id, role: staff.role, ip: staff.ip });
const excerpt = (text: string | null | undefined, n = 160) => (text ? (text.length > n ? `${text.slice(0, n)}…` : text) : null);

/** Moderators can't moderate content owned by staff of the same or a higher role. */
async function assertOwnerBelow(staff: StaffContext, ownerId: string) {
  if (ownerId === staff.id) throw new HttpError(400, 'CANNOT_ACT_ON_SELF', "You can't moderate your own content");
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { platformRole: true } });
  if (owner && ROLE_RANK[owner.platformRole as PlatformRole] >= ROLE_RANK[staff.role]) {
    throw new HttpError(403, 'FORBIDDEN_TARGET', "You can't moderate content of staff with the same or a higher role");
  }
}

interface Removable {
  ownerId: string;
  removedAt: Date | null;
  removalReason: string | null;
  summary: Record<string, unknown>;
}

async function loadRemovable(type: ModerationTarget, id: string): Promise<Removable | null> {
  switch (type) {
    case 'post': {
      const p = await prisma.post.findUnique({ where: { id }, select: { authorId: true, removedAt: true, removalReason: true, body: true, type: true } });
      return p && { ownerId: p.authorId, removedAt: p.removedAt, removalReason: p.removalReason, summary: { postType: p.type, excerpt: excerpt(p.body) } };
    }
    case 'comment': {
      const c = await prisma.comment.findUnique({ where: { id }, select: { authorId: true, removedAt: true, removalReason: true, body: true, postId: true } });
      return c && { ownerId: c.authorId, removedAt: c.removedAt, removalReason: c.removalReason, summary: { postId: c.postId, excerpt: excerpt(c.body) } };
    }
    case 'portfolio-item': {
      const i = await prisma.portfolioItem.findUnique({ where: { id }, select: { ownerId: true, removedAt: true, removalReason: true, title: true, type: true } });
      return i && { ownerId: i.ownerId, removedAt: i.removedAt, removalReason: i.removalReason, summary: { title: i.title, workType: i.type } };
    }
    default:
      return null;
  }
}

const removalData = (staff: StaffContext, reason: string | null, removed: boolean) =>
  removed ? { removedAt: new Date(), removedById: staff.id, removalReason: reason } : { removedAt: null, removedById: null, removalReason: null };

async function applyRemoval(tx: Prisma.TransactionClient, type: ModerationTarget, id: string, data: ReturnType<typeof removalData>) {
  if (type === 'post') await tx.post.update({ where: { id }, data });
  else if (type === 'comment') await tx.comment.update({ where: { id }, data });
  else if (type === 'portfolio-item') await tx.portfolioItem.update({ where: { id }, data });
}

/**
 * Removes content with a mandatory reason. Posts, comments and portfolio items are soft-removed
 * (hidden everywhere, ownership and history kept, restorable). Profile photos/covers are
 * detached and their files deleted — that cannot be restored.
 */
export async function removeContent(staff: StaffContext, type: ModerationTarget, id: string, reason: string, reportId?: string) {
  assertCan(staff, 'content.moderate');

  if (type === 'profile-avatar' || type === 'profile-cover') {
    const field = type === 'profile-avatar' ? 'avatarAssetId' : 'coverAssetId';
    const profile = await prisma.profile.findUnique({ where: { userId: id }, select: { avatarAssetId: true, coverAssetId: true, avatarAsset: true, coverAsset: true } });
    const assetId = profile?.[field];
    if (!profile || !assetId) throw new HttpError(404, 'CONTENT_NOT_FOUND', 'There is no image to remove');
    await assertOwnerBelow(staff, id);
    const asset = type === 'profile-avatar' ? profile.avatarAsset : profile.coverAsset;
    await prisma.$transaction(async (tx) => {
      await tx.profile.update({ where: { userId: id }, data: { [field]: null } });
      await writeAudit(tx, {
        actor: actorOf(staff),
        action: 'content.remove',
        target: { type: type.toUpperCase().replace('-', '_'), id },
        reason,
        before: { assetId, publicId: asset?.publicId ?? null, reportId: reportId ?? null },
        after: { assetId: null, permanent: true },
      });
    });
    await releaseAssets([assetId]);
    return { removed: true, restorable: false };
  }

  const item = await loadRemovable(type, id);
  if (!item) throw new HttpError(404, 'CONTENT_NOT_FOUND', 'Content not found');
  if (item.removedAt) throw new HttpError(409, 'ALREADY_REMOVED', 'This content has already been removed');
  await assertOwnerBelow(staff, item.ownerId);
  await prisma.$transaction(async (tx) => {
    await applyRemoval(tx, type, id, removalData(staff, reason, true));
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: 'content.remove',
      target: { type: type.toUpperCase().replace('-', '_'), id },
      reason,
      before: { removed: false, ownerId: item.ownerId, ...item.summary, reportId: reportId ?? null } as Prisma.InputJsonValue,
      after: { removed: true },
    });
  });
  return { removed: true, restorable: true };
}

export async function restoreContent(staff: StaffContext, type: ModerationTarget, id: string, reason: string) {
  assertCan(staff, 'content.moderate');
  if (type === 'profile-avatar' || type === 'profile-cover') {
    throw new HttpError(400, 'NOT_RESTORABLE', 'Removed profile images are deleted and cannot be restored');
  }
  const item = await loadRemovable(type, id);
  if (!item) throw new HttpError(404, 'CONTENT_NOT_FOUND', 'Content not found');
  if (!item.removedAt) throw new HttpError(409, 'NOT_REMOVED', 'This content is not removed');
  await assertOwnerBelow(staff, item.ownerId);
  await prisma.$transaction(async (tx) => {
    await applyRemoval(tx, type, id, removalData(staff, null, false));
    await writeAudit(tx, {
      actor: actorOf(staff),
      action: 'content.restore',
      target: { type: type.toUpperCase().replace('-', '_'), id },
      reason,
      before: { removed: true, removalReason: item.removalReason },
      after: { removed: false },
    });
  });
  return { removed: false };
}

/** Content oversight list: visible or removed posts, comments and portfolio items. */
export async function listContent(staff: StaffContext, query: ContentQuery) {
  assertCan(staff, 'content.moderate');
  const removed = query.state === 'removed' ? { removedAt: { not: null } } : { removedAt: null };
  const q = query.q ? { contains: query.q, mode: 'insensitive' as const } : undefined;
  const order = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

  if (query.type === 'post') {
    const page = await paginate(query, (args) =>
      prisma.post.findMany({
        where: { ...removed, ...(q && { body: q }) },
        include: { author: { select: personSelect }, media: { include: { asset: true }, orderBy: { position: 'asc' }, take: 1 }, portfolioItem: { select: { title: true } } },
        orderBy: order,
        ...args,
      }),
    );
    return withReportCounts('POST', page, (p) => ({
      id: p.id,
      kind: 'post' as const,
      title: p.type === 'SHOWCASE' ? `Shared work: ${p.portfolioItem?.title ?? ''}` : null,
      excerpt: excerpt(p.body),
      author: toPerson(p.author),
      thumbnail: p.media[0] ? (toMediaView(p.media[0].asset).urls.small ?? toMediaView(p.media[0].asset).urls.poster ?? null) : null,
      createdAt: p.createdAt.toISOString(),
      removedAt: p.removedAt?.toISOString() ?? null,
      removalReason: p.removalReason,
      link: `/p/${p.id}`,
    }));
  }
  if (query.type === 'comment') {
    const page = await paginate(query, (args) =>
      prisma.comment.findMany({ where: { ...removed, ...(q && { body: q }) }, include: { author: { select: personSelect } }, orderBy: order, ...args }),
    );
    return withReportCounts('COMMENT', page, (c) => ({
      id: c.id,
      kind: 'comment' as const,
      title: null,
      excerpt: excerpt(c.body),
      author: toPerson(c.author),
      thumbnail: null,
      createdAt: c.createdAt.toISOString(),
      removedAt: c.removedAt?.toISOString() ?? null,
      removalReason: c.removalReason,
      link: `/p/${c.postId}`,
    }));
  }
  const page = await paginate(query, (args) =>
    prisma.portfolioItem.findMany({
      where: { ...removed, ...(q && { OR: [{ title: q }, { description: q }] }) },
      include: { owner: { select: personSelect }, coverAsset: true, mediaAsset: true },
      orderBy: order,
      ...args,
    }),
  );
  return withReportCounts('PORTFOLIO_ITEM', page, (i) => {
    const visual = i.coverAsset ?? (i.mediaAsset?.kind === 'IMAGE' ? i.mediaAsset : null);
    return {
      id: i.id,
      kind: 'portfolio-item' as const,
      title: i.title,
      excerpt: excerpt(i.description),
      author: toPerson(i.owner),
      thumbnail: visual ? (toMediaView(visual).urls.small ?? null) : null,
      createdAt: i.createdAt.toISOString(),
      removedAt: i.removedAt?.toISOString() ?? null,
      removalReason: i.removalReason,
      link: `/work/${i.id}`,
    };
  });
}

async function withReportCounts<T extends { id: string }, U extends { id: string }>(
  targetType: 'POST' | 'COMMENT' | 'PORTFOLIO_ITEM',
  page: { items: T[]; nextCursor: string | null },
  map: (row: T) => U,
) {
  const counts = await prisma.report.groupBy({
    by: ['targetId'],
    where: { targetType, targetId: { in: page.items.map((i) => i.id) }, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.targetId, c._count._all]));
  return { nextCursor: page.nextCursor, items: page.items.map((row) => ({ ...map(row), openReports: byId.get(row.id) ?? 0 })) };
}
