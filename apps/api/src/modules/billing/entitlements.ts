import { PLAN_LIMITS, type Entitlements, type PlanKey } from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';

/**
 * THE single place that answers "what may this user do?" (ADR 0004). Everything is computed at
 * request time from stored periods (ACTIVE and periodStart <= now < periodEnd) — never from a
 * scheduled job flipping flags. Free is the default when nothing applies.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 86_400_000;
const RANK: Record<PlanKey, number> = { FREE: 0, CREATOR_PLUS: 1, PRO: 2 };

export async function getEntitlements(userId: string, now = new Date(), db: Db = prisma): Promise<Entitlements> {
  const subs = await db.subscription.findMany({
    where: { userId, status: 'ACTIVE', periodEnd: { gt: now } },
    orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
  });
  const current = subs.filter((s) => s.periodStart <= now);
  const best = current.reduce<(typeof current)[number] | null>((a, s) => (!a || RANK[s.plan] > RANK[a.plan] ? s : a), null);
  const plan: PlanKey = best?.plan ?? 'FREE';
  // The plan stays in force until the last contiguous period of the same-or-higher plan ends.
  let until = best?.periodEnd ?? null;
  if (best)
    for (const s of subs) if (RANK[s.plan] >= RANK[plan] && until && s.periodStart <= until && s.periodEnd > until) until = s.periodEnd;
  return {
    plan,
    planUntil: until?.toISOString() ?? null,
    limits: PLAN_LIMITS[plan],
    subscriptions: subs.map((s) => ({
      id: s.id,
      plan: s.plan,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      status: s.status,
    })),
  };
}

/** Serialise grants for one key inside the caller's transaction (no double extension under concurrency). */
async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * Adds a paid subscription period (called by fulfilment in Phase 3). Rules (owner decisions):
 *  - same plan already running or queued → extends from its current end;
 *  - upgrade (higher plan than any running) → starts now; no proration (disclosed before payment);
 *  - downgrade (lower plan while a higher one runs) → starts when the higher plan's periods end.
 */
export async function grantSubscription(
  tx: Prisma.TransactionClient,
  userId: string,
  plan: 'CREATOR_PLUS' | 'PRO',
  days: number,
  now = new Date(),
) {
  if (!Number.isInteger(days) || days <= 0) throw new Error('grantSubscription: days must be a positive integer');
  await lock(tx, `subscription:${userId}`);
  const future = await tx.subscription.findMany({
    where: { userId, status: 'ACTIVE', periodEnd: { gt: now } },
    orderBy: { periodEnd: 'desc' },
  });
  const samePlanEnd = future.filter((s) => s.plan === plan).reduce<Date | null>((m, s) => (!m || s.periodEnd > m ? s.periodEnd : m), null);
  const higherEnd = future
    .filter((s) => RANK[s.plan] > RANK[plan])
    .reduce<Date | null>((m, s) => (!m || s.periodEnd > m ? s.periodEnd : m), null);
  let start = now;
  if (samePlanEnd && samePlanEnd > start) start = samePlanEnd;
  if (higherEnd && higherEnd > start) start = higherEnd;
  // Lower-plan periods queued to begin at or after this one's start haven't been used yet:
  // push them back by the new period so no paid, unused days are swallowed by the overlap.
  const queuedLower = future.filter((s) => RANK[s.plan] < RANK[plan] && s.periodStart >= start);
  for (const s of queuedLower) {
    await tx.subscription.update({
      where: { id: s.id },
      data: { periodStart: new Date(s.periodStart.getTime() + days * DAY), periodEnd: new Date(s.periodEnd.getTime() + days * DAY) },
    });
  }
  return tx.subscription.create({ data: { userId, plan, periodStart: start, periodEnd: new Date(start.getTime() + days * DAY) } });
}

/**
 * Adds a Post Boost or Profile Spotlight period. One per target: buying again extends from the
 * current end, so periods never overlap. Only the post's author / the profile's owner may promote it.
 */
export async function grantPromotion(
  tx: Prisma.TransactionClient,
  userId: string,
  product: 'POST_BOOST' | 'PROFILE_SPOTLIGHT',
  targetId: string,
  days: number,
  now = new Date(),
) {
  if (!Number.isInteger(days) || days <= 0) throw new Error('grantPromotion: days must be a positive integer');
  const targetType = product === 'POST_BOOST' ? 'POST' : 'PROFILE';
  if (targetType === 'POST') {
    const post = await tx.post.findUnique({ where: { id: targetId }, select: { authorId: true, removedAt: true } });
    if (!post || post.removedAt) throw new HttpError(404, 'PROMOTION_TARGET_NOT_FOUND', 'That post no longer exists');
    if (post.authorId !== userId) throw new HttpError(403, 'NOT_OWNER', 'You can only boost your own posts');
  } else if (targetId !== userId) {
    throw new HttpError(403, 'NOT_OWNER', 'You can only spotlight your own profile');
  }
  await lock(tx, `promotion:${targetType}:${targetId}`);
  const latest = await tx.promotion.findFirst({
    where: { targetType, targetId, product, status: 'ACTIVE', periodEnd: { gt: now } },
    orderBy: { periodEnd: 'desc' },
  });
  const start = latest ? latest.periodEnd : now;
  return tx.promotion.create({
    data: { userId, product, targetType, targetId, periodStart: start, periodEnd: new Date(start.getTime() + days * DAY) },
  });
}

/** The promotion running right now for a target, if any (used by placement in Phase 4). */
export async function activePromotion(targetType: 'POST' | 'PROFILE', targetId: string, now = new Date(), db: Db = prisma) {
  return db.promotion.findFirst({ where: { targetType, targetId, status: 'ACTIVE', periodStart: { lte: now }, periodEnd: { gt: now } } });
}
