import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchOutbox } from '../../lib/outbox.js';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { useSandboxPayments } from '../../test/payment-fixtures.js';
import { seedCatalogue } from '../billing/catalogue.service.js';
import type { FakePaymentProvider } from '../payments/providers/fake.js';
import { promotionNoticesSweep } from './promotions.service.js';

let fake: FakePaymentProvider;
let app: ReturnType<typeof testApp>;
let n = 0;
type Agent = ReturnType<typeof request.agent>;

beforeEach(async () => {
  await resetDatabase();
  fake = useSandboxPayments();
  app = testApp();
  await seedCatalogue();
});

async function drain() {
  for (let i = 0; i < 10; i += 1) if ((await dispatchOutbox()) === 0) return;
}
async function startPromo(agent: Agent, body: object) {
  return agent
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', `promo-${Date.now()}-${(n += 1)}`)
    .send(body);
}
async function pay(ref: string, before?: () => Promise<unknown>) {
  fake.settle(ref, 'paid');
  await before?.();
  const hook = fake.signedWebhook(ref, 'payment.complete');
  await request(app).post('/api/v1/payments/webhooks/fake').set(hook.headers).send(hook.body.toString());
  await drain();
  return prisma.order.findUniqueOrThrow({ where: { reference: ref } });
}
async function boostedPost() {
  const u = await signUp(app);
  const post = await u.agent.post('/api/v1/posts').send({ body: 'New single out now' });
  const res = await startPromo(u.agent, { product: 'POST_BOOST', option: 'DAYS_3', targetId: post.body.id });
  expect(res.status).toBe(201);
  return { u, postId: post.body.id as string, ref: res.body.order.reference as string };
}
const promoted = async () => (await request(app).get('/api/v1/promoted/posts')).body.items as { id: string; promotedUntil: string }[];
const shiftPromotions = (days: number) =>
  prisma.$executeRaw`UPDATE "promotion" SET "periodStart" = "periodStart" - make_interval(days => ${days}), "periodEnd" = "periodEnd" - make_interval(days => ${days})`;

describe('Post Boost', () => {
  it('select post → duration → price → pay → verified → promoted slot, labelled, separate from organic paging', async () => {
    const { u, postId, ref } = await boostedPost();
    expect((await promoted()).length).toBe(0); // nothing before verified payment
    const order = await pay(ref);
    expect(order).toMatchObject({ status: 'FULFILLED', amountXaf: 1000, targetId: postId });
    const items = await promoted();
    expect(items.map((i) => i.id)).toEqual([postId]);
    expect(new Date(items[0]!.promotedUntil).getTime() - order.paidAt!.getTime()).toBeLessThan(3 * 86_400_000 + 5_000);
    // Organic feed is untouched: the post appears once, unflagged, in its normal place.
    const feed = await request(app).get('/api/v1/feed');
    expect(feed.body.items.filter((p: { id: string }) => p.id === postId)).toHaveLength(1);
    expect(feed.body.items[0]).not.toHaveProperty('promotedUntil');
    const receipt = await u.agent.get(`/api/v1/billing/orders/${ref}`);
    expect(receipt.body.granted).toMatchObject({ label: 'Post Boost' });
    const mine = await u.agent.get('/api/v1/billing/promotions');
    expect(mine.body.items[0]).toMatchObject({ product: 'POST_BOOST', state: 'running', targetId: postId });
  });

  it('expires exactly at its end; "ended" notice once', async () => {
    const { ref } = await boostedPost();
    await pay(ref);
    await shiftPromotions(3); // periodEnd is now in the past
    expect(await promoted()).toEqual([]);
    await promotionNoticesSweep();
    await promotionNoticesSweep();
    expect(await prisma.notification.count({ where: { type: 'promotion.ended' } })).toBe(1);
  });

  it('buying again extends from the current end (one boost per post, never overlapping); the preview says so', async () => {
    const { u, postId, ref } = await boostedPost();
    await pay(ref);
    const preview = await u.agent.get(`/api/v1/billing/promotion-preview?product=POST_BOOST&option=DAYS_7&targetId=${postId}`);
    expect(preview.body.extendsCurrent).toBe(true);
    const second = await startPromo(u.agent, { product: 'POST_BOOST', option: 'DAYS_7', targetId: postId });
    await pay(second.body.order.reference);
    const rows = await prisma.promotion.findMany({ where: { targetId: postId }, orderBy: { periodStart: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]!.periodStart.toISOString()).toBe(rows[0]!.periodEnd.toISOString());
    expect(preview.body.startsAt).toBe(rows[0]!.periodEnd.toISOString());
  });

  it('moderation removing the post ends the promotion at once, tells the owner, and restoring does not revive it', async () => {
    const { u, postId, ref } = await boostedPost();
    await pay(ref);
    const mod = await makeStaff(app, 'MODERATOR');
    const removed = await mod.agent
      .post(`/api/v1/admin/content/post/${postId}/remove`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Spam content' });
    expect(removed.status).toBe(200);
    expect(await promoted()).toEqual([]);
    expect(await prisma.promotion.findFirstOrThrow()).toMatchObject({
      status: 'CANCELLED',
      endedReason: 'The post was removed by moderation',
    });
    const notes = (await u.agent.get('/api/v1/notifications')).body.items.map((x: { type: string }) => x.type);
    expect(notes).toContain('promotion.ended_early');
    await mod.agent.post(`/api/v1/admin/content/post/${postId}/restore`).set('Origin', ORIGIN).send({ reason: 'Removed by mistake' });
    expect(await promoted()).toEqual([]);
  });

  it('a moderator can end a promotion with a reason (audited); members cannot', async () => {
    const { u, ref } = await boostedPost();
    await pay(ref);
    const promo = await prisma.promotion.findFirstOrThrow();
    expect(
      (await u.agent.post(`/api/v1/admin/promotions/${promo.id}/end`).set('Origin', ORIGIN).send({ reason: 'Ending it myself' })).status,
    ).toBe(403);
    const mod = await makeStaff(app, 'MODERATOR');
    const list = await mod.agent.get('/api/v1/admin/promotions');
    expect(list.body.items[0]).toMatchObject({ id: promo.id, running: true });
    const res = await mod.agent
      .post(`/api/v1/admin/promotions/${promo.id}/end`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Misleading content' });
    expect(res.status).toBe(200);
    expect(await promoted()).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: 'promotion.end', targetId: promo.id } })).toBe(1);
    expect(
      (await mod.agent.post(`/api/v1/admin/promotions/${promo.id}/end`).set('Origin', ORIGIN).send({ reason: 'Again please' })).status,
    ).toBe(409);
  });

  it('a suspended author’s boost stops showing; the post being deleted before fulfilment → NEEDS_REVIEW, nothing granted', async () => {
    const a = await boostedPost();
    await pay(a.ref);
    await prisma.user.update({ where: { id: a.u.userId }, data: { status: 'SUSPENDED' } });
    expect(await promoted()).toEqual([]);

    const b = await boostedPost();
    const order = await pay(b.ref, () => b.u.agent.delete(`/api/v1/posts/${b.postId}`));
    expect(order).toMatchObject({ status: 'NEEDS_REVIEW', statusReason: 'target_unavailable' });
    expect(await prisma.promotion.count({ where: { targetId: b.postId } })).toBe(0);
  });

  it('only your own posts can be boosted; others’ promotions are private', async () => {
    const { u, ref } = await boostedPost();
    await pay(ref);
    const other = await signUp(app);
    expect((await other.agent.get('/api/v1/billing/promotions')).body.items).toEqual([]);
    const promo = await prisma.promotion.findFirstOrThrow();
    expect((await other.agent.get(`/api/v1/billing/promotions/${promo.id}`)).status).toBe(404);
    expect((await u.agent.get(`/api/v1/billing/promotions/${promo.id}`)).status).toBe(200);
  });
});

describe('Profile Spotlight', () => {
  it('buy → verified → labelled Spotlight row; expires; only your own profile', async () => {
    const u = await signUp(app);
    const other = await signUp(app);
    expect((await startPromo(u.agent, { product: 'PROFILE_SPOTLIGHT', option: 'DAYS_3', targetId: other.userId })).status).toBe(403);
    const res = await startPromo(u.agent, { product: 'PROFILE_SPOTLIGHT', option: 'DAYS_3' });
    expect(res.status).toBe(201);
    await pay(res.body.order.reference);
    const row = await request(app).get('/api/v1/promoted/spotlight');
    expect(row.body.people.map((p: { username: string }) => p.username)).toEqual([u.input.username]);
    await shiftPromotions(3);
    expect((await request(app).get('/api/v1/promoted/spotlight')).body.people).toEqual([]);
  });
});
