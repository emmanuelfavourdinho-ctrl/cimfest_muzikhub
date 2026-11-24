import { FREE_LIMITS, PLAN_LIMITS } from '@muzikhub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { activePromotion, getEntitlements, grantPromotion, grantSubscription } from './entitlements.js';

const app = testApp();
beforeEach(resetDatabase);

const DAY = 86_400_000;
const T0 = new Date('2026-12-01T00:00:00.000Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const sub = (userId: string, plan: 'CREATOR_PLUS' | 'PRO', days: number, now = T0) =>
  prisma.$transaction((tx) => grantSubscription(tx, userId, plan, days, now));

describe('entitlements: computed from stored periods at request time', () => {
  it('Free is the default with no subscription, and Free limits equal today’s limits', async () => {
    const u = await signUp(app);
    const e = await getEntitlements(u.userId, T0);
    expect(e).toMatchObject({ plan: 'FREE', planUntil: null, subscriptions: [] });
    expect(e.limits).toEqual(FREE_LIMITS);
  });

  it('boundaries: active from periodStart (inclusive) to periodEnd (exclusive)', async () => {
    const u = await signUp(app);
    await sub(u.userId, 'CREATOR_PLUS', 30);
    expect((await getEntitlements(u.userId, new Date(T0.getTime() - 1))).plan).toBe('FREE');
    expect((await getEntitlements(u.userId, T0)).plan).toBe('CREATOR_PLUS');
    expect((await getEntitlements(u.userId, new Date(at(30).getTime() - 1))).plan).toBe('CREATOR_PLUS');
    expect((await getEntitlements(u.userId, at(30))).plan).toBe('FREE');
    expect((await getEntitlements(u.userId, T0)).limits).toEqual(PLAN_LIMITS.CREATOR_PLUS);
  });

  it('cancelled or refunded periods grant nothing, even inside their dates', async () => {
    const u = await signUp(app);
    const s = await sub(u.userId, 'PRO', 30);
    await prisma.subscription.update({ where: { id: s.id }, data: { status: 'REFUNDED' } });
    expect((await getEntitlements(u.userId, at(1))).plan).toBe('FREE');
  });

  it('renewing the same plan extends from the current end date, not from today', async () => {
    const u = await signUp(app);
    await sub(u.userId, 'CREATOR_PLUS', 30);
    const second = await sub(u.userId, 'CREATOR_PLUS', 30, at(10));
    expect(second.periodStart.toISOString()).toBe(at(30).toISOString());
    expect(second.periodEnd.toISOString()).toBe(at(60).toISOString());
    const e = await getEntitlements(u.userId, at(10));
    expect(e.planUntil).toBe(at(60).toISOString());
    expect((await getEntitlements(u.userId, at(45))).plan).toBe('CREATOR_PLUS');
  });

  it('renewing after expiry starts from now (no back-dating)', async () => {
    const u = await signUp(app);
    await sub(u.userId, 'CREATOR_PLUS', 30);
    const later = await sub(u.userId, 'CREATOR_PLUS', 30, at(40));
    expect(later.periodStart.toISOString()).toBe(at(40).toISOString());
  });

  it('upgrade starts now (no proration); downgrade waits for the higher plan to end', async () => {
    const u = await signUp(app);
    await sub(u.userId, 'CREATOR_PLUS', 30);
    const pro = await sub(u.userId, 'PRO', 30, at(10));
    expect(pro.periodStart.toISOString()).toBe(at(10).toISOString());
    expect((await getEntitlements(u.userId, at(10))).plan).toBe('PRO');

    const down = await sub(u.userId, 'CREATOR_PLUS', 30, at(12));
    expect(down.periodStart.toISOString()).toBe(at(40).toISOString());
    expect((await getEntitlements(u.userId, at(39))).plan).toBe('PRO');
    expect((await getEntitlements(u.userId, at(40))).plan).toBe('CREATOR_PLUS');
    expect((await getEntitlements(u.userId, at(70))).plan).toBe('FREE');
  });

  it('extending the higher plan pushes a queued lower plan back, so no unused paid days are lost', async () => {
    const u = await signUp(app);
    await sub(u.userId, 'PRO', 30);
    const queued = await sub(u.userId, 'CREATOR_PLUS', 30, at(1)); // 30 → 60
    await sub(u.userId, 'PRO', 30, at(2)); // PRO 30 → 60, Plus moves to 60 → 90
    const moved = await prisma.subscription.findUniqueOrThrow({ where: { id: queued.id } });
    expect([moved.periodStart.toISOString(), moved.periodEnd.toISOString()]).toEqual([at(60).toISOString(), at(90).toISOString()]);
    expect((await getEntitlements(u.userId, at(59))).plan).toBe('PRO');
    expect((await getEntitlements(u.userId, at(89))).plan).toBe('CREATOR_PLUS');
  });

  it('concurrent renewals never overlap (advisory lock)', async () => {
    const u = await signUp(app);
    await Promise.all([sub(u.userId, 'CREATOR_PLUS', 30), sub(u.userId, 'CREATOR_PLUS', 30), sub(u.userId, 'CREATOR_PLUS', 30)]);
    const rows = await prisma.subscription.findMany({ where: { userId: u.userId }, orderBy: { periodStart: 'asc' } });
    expect(rows.map((r) => r.periodStart.toISOString())).toEqual([T0, at(30), at(60)].map((d) => d.toISOString()));
  });

  it('rejects non-positive or fractional durations', async () => {
    const u = await signUp(app);
    await expect(sub(u.userId, 'PRO', 0)).rejects.toThrow(/positive integer/);
    await expect(sub(u.userId, 'PRO', 1.5)).rejects.toThrow(/positive integer/);
  });
});

describe('promotions: one per target, extend not overlap', () => {
  const promote = (userId: string, product: 'POST_BOOST' | 'PROFILE_SPOTLIGHT', target: string, days: number, now = T0) =>
    prisma.$transaction((tx) => grantPromotion(tx, userId, product, target, days, now));

  it('a second boost on the same post extends from the current end date', async () => {
    const u = await signUp(app);
    const post = await u.agent.post('/api/v1/posts').send({ body: 'my new beat' });
    await promote(u.userId, 'POST_BOOST', post.body.id, 7);
    const second = await promote(u.userId, 'POST_BOOST', post.body.id, 3, at(2));
    expect(second.periodStart.toISOString()).toBe(at(7).toISOString());
    expect(second.periodEnd.toISOString()).toBe(at(10).toISOString());
    // Exactly one running at any instant.
    for (const d of [0, 6, 7, 9]) expect((await activePromotion('POST', post.body.id, at(d)))?.periodStart).toBeTruthy();
    expect(await activePromotion('POST', post.body.id, at(10))).toBeNull();
  });

  it('boosts on different posts are independent', async () => {
    const u = await signUp(app);
    const a = await u.agent.post('/api/v1/posts').send({ body: 'post a' });
    const b = await u.agent.post('/api/v1/posts').send({ body: 'post b' });
    await promote(u.userId, 'POST_BOOST', a.body.id, 7);
    const pb = await promote(u.userId, 'POST_BOOST', b.body.id, 7);
    expect(pb.periodStart.toISOString()).toBe(T0.toISOString());
  });

  it('a spotlight extends the same profile’s spotlight; concurrent buys never overlap', async () => {
    const u = await signUp(app);
    await Promise.all([promote(u.userId, 'PROFILE_SPOTLIGHT', u.userId, 3), promote(u.userId, 'PROFILE_SPOTLIGHT', u.userId, 3)]);
    const rows = await prisma.promotion.findMany({ where: { targetId: u.userId }, orderBy: { periodStart: 'asc' } });
    expect(rows.map((r) => [r.periodStart.toISOString(), r.periodEnd.toISOString()])).toEqual([
      [T0.toISOString(), at(3).toISOString()],
      [at(3).toISOString(), at(6).toISOString()],
    ]);
  });

  it('only the owner can promote: someone else’s post or profile is refused', async () => {
    const owner = await signUp(app);
    const other = await signUp(app);
    const post = await owner.agent.post('/api/v1/posts').send({ body: 'owner post' });
    await expect(promote(other.userId, 'POST_BOOST', post.body.id, 3)).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });
    await expect(promote(other.userId, 'PROFILE_SPOTLIGHT', owner.userId, 3)).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });
    await expect(promote(owner.userId, 'POST_BOOST', 'does-not-exist', 3)).rejects.toMatchObject({ status: 404 });
  });
});
