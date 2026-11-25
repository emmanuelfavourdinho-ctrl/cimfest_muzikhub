import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import type { AnalyticsEvent, AnalyticsSubject } from '../../generated/prisma/client.js';
import { visibleUser } from '../../lib/account-status.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { limitsFor } from '../billing/entitlements.js';
import { publiclyVisible } from '../portfolio/portfolio.service.js';

/**
 * Analytics (owner decision: aggregated daily counters only).
 *   event → server-side validation → de-duplication → daily counter → plan-limited API.
 * Only real, validated events count: the subject must exist and be public, the owner's own
 * views/plays/clicks don't count, obvious bots don't count, and one viewer counts at most once
 * per subject per UTC day (refreshes and repeated requests are ignored).
 */
export const VALID: Record<AnalyticsEvent, AnalyticsSubject[]> = {
  PROFILE_VIEW: ['PROFILE'],
  PLAY: ['PORTFOLIO_ITEM', 'POST'],
  LINK_CLICK: ['PORTFOLIO_ITEM', 'PROFILE_LINK'],
};
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless/i;

export interface Viewer {
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Who owns the subject (and it is publicly visible), or null. */
async function ownerOf(event: AnalyticsEvent, subjectType: AnalyticsSubject, subjectId: string): Promise<string | null> {
  if (!VALID[event].includes(subjectType)) return null;
  switch (subjectType) {
    case 'PROFILE': {
      const u = await prisma.user.findFirst({ where: { id: subjectId, ...visibleUser }, select: { id: true } });
      return u?.id ?? null;
    }
    case 'PORTFOLIO_ITEM': {
      const item = await prisma.portfolioItem.findFirst({
        where: { id: subjectId, ...publiclyVisible, ...(event === 'LINK_CLICK' && { externalUrl: { not: null } }) },
        select: { ownerId: true },
      });
      return item?.ownerId ?? null;
    }
    case 'POST': {
      const post = await prisma.post.findFirst({
        where: { id: subjectId, removedAt: null, author: visibleUser, media: { some: { asset: { kind: { in: ['AUDIO', 'VIDEO'] } } } } },
        select: { authorId: true },
      });
      return post?.authorId ?? null;
    }
    case 'PROFILE_LINK': {
      const link = await prisma.profileLink.findFirst({
        where: { id: subjectId, profile: { user: visibleUser } },
        select: { profileId: true },
      });
      return link?.profileId ?? null;
    }
  }
}

/** Returns true when the event was counted. Never throws for "not counted" (no probing). */
export async function recordEvent(
  event: AnalyticsEvent,
  subjectType: AnalyticsSubject,
  subjectId: string,
  viewer: Viewer,
): Promise<boolean> {
  if (viewer.userAgent && BOT.test(viewer.userAgent)) return false;
  const ownerId = await ownerOf(event, subjectType, subjectId);
  if (!ownerId || viewer.userId === ownerId) return false;
  const viewerKey = viewer.userId ? `u:${viewer.userId}` : `a:${viewer.ip ?? '-'}|${viewer.userAgent ?? '-'}`;
  const day = await utcToday();
  // A key that changes every day: yesterday's hashes can't be matched to today's.
  const dayKey = createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`analytics:${day.toISOString().slice(0, 10)}`)
    .digest();
  const viewerHash = createHmac('sha256', dayKey).update(viewerKey).digest('base64url');
  // One statement: count only if this viewer wasn't already seen for this subject today.
  const counted = await prisma.$executeRaw`
    WITH seen AS (
      INSERT INTO "analytics_seen" ("day", "event", "subjectId", "viewerHash")
      VALUES (${day}::date, ${event}::"AnalyticsEvent", ${subjectId}, ${viewerHash})
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    INSERT INTO "analytics_daily" ("ownerId", "day", "event", "subjectType", "subjectId", "count")
    SELECT ${ownerId}, ${day}::date, ${event}::"AnalyticsEvent", ${subjectType}::"AnalyticsSubject", ${subjectId}, 1 FROM seen
    ON CONFLICT ("ownerId", "day", "event", "subjectType", "subjectId") DO UPDATE SET "count" = "analytics_daily"."count" + 1`;
  return counted > 0;
}

/** Today's UTC date by the database clock. */
async function utcToday(): Promise<Date> {
  const rows = await prisma.$queryRaw<{ day: Date }[]>`SELECT (now() AT TIME ZONE 'UTC')::date AS "day"`;
  return rows[0]!.day;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
async function window(userId: string, requested: number, needItems: boolean) {
  const limits = await limitsFor(userId);
  if (!limits.analyticsDays) throw new HttpError(403, 'PLAN_REQUIRED', 'Analytics are part of Creator Plus and MuzikHub Pro.');
  if (needItems && !limits.itemAnalytics) throw new HttpError(403, 'PLAN_REQUIRED', 'Per-item analytics are part of MuzikHub Pro.');
  // The plan decides how far back you can look (history limit), whatever is requested.
  const days = Math.min(requested, limits.analyticsDays);
  const today = await utcToday();
  const since = new Date(today.getTime() - (days - 1) * 86_400_000);
  return { days, maxDays: limits.analyticsDays, itemAnalytics: limits.itemAnalytics, today, since };
}

/** Your totals and a zero-filled daily series, limited to your plan's history. */
export async function analyticsSummary(userId: string, requestedDays: number) {
  const w = await window(userId, requestedDays, false);
  const rows = await prisma.analyticsDaily.groupBy({
    by: ['day', 'event'],
    where: { ownerId: userId, day: { gte: w.since, lte: w.today } },
    _sum: { count: true },
  });
  const byDay = new Map<string, { views: number; plays: number; clicks: number }>();
  for (let t = w.since.getTime(); t <= w.today.getTime(); t += 86_400_000)
    byDay.set(isoDay(new Date(t)), { views: 0, plays: 0, clicks: 0 });
  const key = { PROFILE_VIEW: 'views', PLAY: 'plays', LINK_CLICK: 'clicks' } as const;
  for (const r of rows) {
    const d = byDay.get(isoDay(r.day));
    if (d) d[key[r.event]] += r._sum.count ?? 0;
  }
  const series = [...byDay.entries()].map(([day, v]) => ({ day, ...v }));
  const totals = series.reduce((t, s) => ({ views: t.views + s.views, plays: t.plays + s.plays, clicks: t.clicks + s.clicks }), {
    views: 0,
    plays: 0,
    clicks: 0,
  });
  return { days: w.days, maxDays: w.maxDays, itemAnalytics: w.itemAnalytics, from: isoDay(w.since), to: isoDay(w.today), totals, series };
}

/** Pro: plays and clicks per work, post and link (titles resolved; deleted items labelled). */
export async function analyticsItems(userId: string, requestedDays: number) {
  const w = await window(userId, requestedDays, true);
  const rows = await prisma.analyticsDaily.groupBy({
    by: ['subjectType', 'subjectId', 'event'],
    where: { ownerId: userId, day: { gte: w.since, lte: w.today }, subjectType: { not: 'PROFILE' } },
    _sum: { count: true },
  });
  const items = new Map<string, { subjectType: AnalyticsSubject; subjectId: string; plays: number; clicks: number }>();
  for (const r of rows) {
    const k = `${r.subjectType}:${r.subjectId}`;
    const it = items.get(k) ?? { subjectType: r.subjectType, subjectId: r.subjectId, plays: 0, clicks: 0 };
    if (r.event === 'PLAY') it.plays += r._sum.count ?? 0;
    if (r.event === 'LINK_CLICK') it.clicks += r._sum.count ?? 0;
    items.set(k, it);
  }
  const ids = (t: AnalyticsSubject) => [...items.values()].filter((i) => i.subjectType === t).map((i) => i.subjectId);
  const [works, posts, links] = await Promise.all([
    prisma.portfolioItem.findMany({ where: { id: { in: ids('PORTFOLIO_ITEM') }, ownerId: userId }, select: { id: true, title: true } }),
    prisma.post.findMany({ where: { id: { in: ids('POST') }, authorId: userId }, select: { id: true, body: true } }),
    prisma.profileLink.findMany({ where: { id: { in: ids('PROFILE_LINK') }, profileId: userId }, select: { id: true, url: true } }),
  ]);
  const title = new Map<string, string>([
    ...works.map((x) => [x.id, x.title] as [string, string]),
    ...posts.map((x) => [x.id, x.body ? (x.body.length > 60 ? `${x.body.slice(0, 57)}…` : x.body) : 'Post'] as [string, string]),
    ...links.map((x) => [x.id, new URL(x.url).hostname.replace(/^www\./, '')] as [string, string]),
  ]);
  const link = (t: AnalyticsSubject, id: string) => (t === 'PORTFOLIO_ITEM' ? `/work/${id}` : t === 'POST' ? `/p/${id}` : null);
  return {
    days: w.days,
    from: isoDay(w.since),
    to: isoDay(w.today),
    items: [...items.values()]
      .map((i) => ({
        ...i,
        title: title.get(i.subjectId) ?? 'Deleted item',
        link: title.has(i.subjectId) ? link(i.subjectType, i.subjectId) : null,
      }))
      .sort((a, b) => b.plays + b.clicks - (a.plays + a.clicks)),
  };
}

/** Retention: de-dup rows after 2 days; daily counters after 400 days (longest plan: 365). */
export async function sweepAnalytics() {
  await prisma.$executeRaw`DELETE FROM "analytics_seen" WHERE "day" < (now() AT TIME ZONE 'UTC')::date - 2`;
  await prisma.$executeRaw`DELETE FROM "analytics_daily" WHERE "day" < (now() AT TIME ZONE 'UTC')::date - 400`;
}

export async function recordProfileView(username: string, viewer: Viewer) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  return u ? recordEvent('PROFILE_VIEW', 'PROFILE', u.id, viewer) : false;
}
