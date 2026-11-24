import { CATALOGUE_OPTIONS, type PersonSummary, type PostView } from '@muzikhub/shared';
import type { Prisma, PromotionTarget } from '../../generated/prisma/client.js';
import { visibleUser } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { dbNow } from '../../lib/db-time.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { StaffContext } from '../../middleware/require-staff.js';
import { visiblePostsByIds } from '../feed/feed.service.js';
import { notify } from '../notifications/notifications.service.js';
import { personSelect, toPerson } from '../profiles/people.js';

type Db = Prisma.TransactionClient | typeof prisma;
/** Running now: ACTIVE and periodStart <= now < periodEnd (computed at read time; expiry needs no job). */
const runningAt = (now: Date) => ({ status: 'ACTIVE' as const, periodStart: { lte: now }, periodEnd: { gt: now } });
const MAX_PROMOTED_POSTS = 1;
const MAX_SPOTLIGHT = 8;

/** Fisher–Yates on a copy: every running promotion gets a fair chance at the slot. */
function shuffled<T>(xs: T[], random = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * The labelled "Promoted" slot for the feed and Discover: outside the organic list and its
 * paging. Only posts that are still visible (not removed, author active) can appear.
 */
export async function promotedPosts(viewer: string | null): Promise<(PostView & { promotedUntil: string })[]> {
  const now = await dbNow();
  const running = await prisma.promotion.findMany({
    where: { targetType: 'POST', ...runningAt(now) },
    select: { targetId: true, periodEnd: true },
  });
  const until = new Map(running.map((r) => [r.targetId, r.periodEnd]));
  const posts = await visiblePostsByIds(shuffled([...until.keys()]), viewer);
  return posts.slice(0, MAX_PROMOTED_POSTS).map((p) => ({ ...p, promotedUntil: until.get(p.id)!.toISOString() }));
}

/** The labelled Spotlight row on Discover: active members with a running Profile Spotlight. */
export async function spotlight(): Promise<PersonSummary[]> {
  const now = await dbNow();
  const running = await prisma.promotion.findMany({ where: { targetType: 'PROFILE', ...runningAt(now) }, select: { targetId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: running.map((r) => r.targetId) }, ...visibleUser }, select: personSelect });
  return shuffled(users).slice(0, MAX_SPOTLIGHT).map(toPerson);
}

/** What buying a promotion would do (extends from the current end; never overlaps). */
export async function previewPromotion(
  userId: string,
  product: 'POST_BOOST' | 'PROFILE_SPOTLIGHT',
  option: keyof typeof CATALOGUE_OPTIONS,
  targetId?: string,
) {
  const targetType: PromotionTarget = product === 'POST_BOOST' ? 'POST' : 'PROFILE';
  const target = product === 'PROFILE_SPOTLIGHT' ? userId : targetId;
  if (!target) throw new HttpError(400, 'TARGET_REQUIRED', 'Choose which of your posts to boost.');
  if (product === 'POST_BOOST') {
    const post = await prisma.post.findFirst({ where: { id: target, removedAt: null }, select: { authorId: true, body: true } });
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post no longer exists.');
    if (post.authorId !== userId) throw new HttpError(403, 'NOT_OWNER', 'You can only boost your own posts.');
  } else if (targetId && targetId !== userId) {
    throw new HttpError(403, 'NOT_OWNER', 'You can only spotlight your own profile.');
  }
  const now = await dbNow();
  const latest = await prisma.promotion.findFirst({
    where: { targetType, targetId: target, product, status: 'ACTIVE', periodEnd: { gt: now } },
    orderBy: { periodEnd: 'desc' },
  });
  const start = latest ? latest.periodEnd : now;
  const end = new Date(start.getTime() + CATALOGUE_OPTIONS[option].days * 86_400_000);
  return { product, targetId: target, startsAt: start.toISOString(), endsAt: end.toISOString(), extendsCurrent: Boolean(latest) };
}

/** Your promotions with their state (running, queued, ended) and any early-end reason. */
export async function ownPromotions(userId: string) {
  const now = await dbNow();
  const rows = await prisma.promotion.findMany({ where: { userId }, orderBy: { periodStart: 'desc' }, take: 50 });
  const posts = await prisma.post.findMany({
    where: { id: { in: rows.filter((r) => r.targetType === 'POST').map((r) => r.targetId) } },
    select: { id: true, body: true },
  });
  const title = new Map(posts.map((p) => [p.id, p.body ? (p.body.length > 60 ? `${p.body.slice(0, 57)}…` : p.body) : 'Post']));
  return rows.map((r) => ({
    id: r.id,
    product: r.product,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetType === 'PROFILE' ? 'Your profile' : (title.get(r.targetId) ?? 'Deleted post'),
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    state: r.status !== 'ACTIVE' ? 'ended' : r.periodEnd <= now ? 'ended' : r.periodStart > now ? 'queued' : 'running',
    endedReason: r.endedReason,
  }));
}

/** Ends every unexpired promotion of a target (moderation). Same transaction as the removal. */
export async function endPromotionsForTarget(
  tx: Db,
  targetType: PromotionTarget,
  targetId: string,
  reason: string,
  actorId: string | null,
) {
  const now = await dbNow(tx);
  const affected = await tx.promotion.findMany({ where: { targetType, targetId, status: 'ACTIVE', periodEnd: { gt: now } } });
  if (affected.length === 0) return 0;
  await tx.promotion.updateMany({
    where: { id: { in: affected.map((a) => a.id) } },
    data: { status: 'CANCELLED', endedAt: now, endedReason: reason, endedById: actorId },
  });
  for (const userId of new Set(affected.map((a) => a.userId))) {
    await notify(tx, userId, {
      type: 'promotion.ended_early',
      title: 'Your promotion was ended',
      body: `${reason}. It no longer appears in Promoted or Spotlight. Contact support about a refund.`,
      link: '/settings/billing',
    });
  }
  return affected.length;
}

/** Staff: end one promotion early (content.moderate), with a reason; audited; owner notified. */
export async function endPromotion(staff: StaffContext, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.promotion.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Promotion not found');
    const now = await dbNow(tx);
    if (p.status !== 'ACTIVE' || p.periodEnd <= now) throw new HttpError(409, 'PROMOTION_NOT_RUNNING', 'This promotion has already ended.');
    await tx.promotion.update({ where: { id }, data: { status: 'CANCELLED', endedAt: now, endedReason: reason, endedById: staff.id } });
    await writeAudit(tx, {
      actor: { id: staff.id, role: staff.role, ip: staff.ip },
      action: 'promotion.end',
      target: { type: 'promotion', id },
      reason,
      before: { status: p.status, periodEnd: p.periodEnd.toISOString() },
      after: { status: 'CANCELLED' },
    });
    await notify(tx, p.userId, {
      type: 'promotion.ended_early',
      title: 'Your promotion was ended',
      body: `A moderator ended your ${p.product === 'POST_BOOST' ? 'Post Boost' : 'Profile Spotlight'}: ${reason}`,
      link: '/settings/billing',
    });
    return { id, status: 'CANCELLED' as const };
  });
}

/** Staff list of promotions (running first). */
export async function adminPromotions(state: 'running' | 'all') {
  const now = await dbNow();
  const rows = await prisma.promotion.findMany({
    where: state === 'running' ? runningAt(now) : {},
    orderBy: [{ periodEnd: 'desc' }],
    take: 100,
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    product: r.product,
    targetType: r.targetType,
    targetId: r.targetId,
    user: r.user,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    status: r.status,
    running: r.status === 'ACTIVE' && r.periodStart <= now && r.periodEnd > now,
    endedReason: r.endedReason,
  }));
}

/** In-app "your promotion has ended" once per period that ended naturally (no continuation). */
export async function promotionNoticesSweep() {
  const now = await dbNow();
  const ended = await prisma.$queryRaw<{ id: string; userId: string; product: string }[]>`
    SELECT p."id", p."userId", p."product" FROM "promotion" p
    WHERE p."status" = 'ACTIVE' AND p."periodEnd" <= ${now} AND p."periodEnd" > ${new Date(now.getTime() - 7 * 86_400_000)}
      AND NOT EXISTS (SELECT 1 FROM "promotion" n WHERE n."targetType" = p."targetType" AND n."targetId" = p."targetId"
                      AND n."status" = 'ACTIVE' AND n."id" <> p."id" AND n."periodStart" <= p."periodEnd" AND n."periodEnd" > p."periodEnd")`;
  for (const p of ended) {
    await notify(prisma, p.userId, {
      type: 'promotion.ended',
      title: `Your ${p.product === 'POST_BOOST' ? 'Post Boost' : 'Profile Spotlight'} has ended`,
      body: 'It no longer appears in the Promoted or Spotlight places. You can buy another from the same place.',
      link: '/settings/billing',
      dedupeKey: `promotion-ended:${p.id}`,
    });
  }
  return ended.length;
}
