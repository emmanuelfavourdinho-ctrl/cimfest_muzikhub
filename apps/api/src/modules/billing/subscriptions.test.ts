import request from 'supertest';
import { FREE_LIMITS, MB, PLAN_LIMITS } from '@muzikhub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchOutbox } from '../../lib/outbox.js';
import { prisma } from '../../lib/prisma.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { useSandboxPayments } from '../../test/payment-fixtures.js';
import type { FakePaymentProvider } from '../payments/providers/fake.js';
import { seedCatalogue } from './catalogue.service.js';
import { getEntitlements } from './entitlements.js';
import { subscriptionNoticesSweep } from './subscriptions.service.js';

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
async function startCheckout(agent: Agent, product: string, option: string) {
  return agent
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', `sub-test-${Date.now()}-${(n += 1)}`)
    .send({ product, option });
}
/** Full sandbox purchase: checkout → provider outcome → signed webhook → verification → fulfilment. */
async function buy(agent: Agent, product: string, option: string, outcome = 'paid') {
  const res = await startCheckout(agent, product, option);
  expect(res.status).toBe(201);
  const ref = res.body.order.reference as string;
  fake.settle(ref, outcome);
  const hook = fake.signedWebhook(ref, `payment.${outcome}`);
  expect((await request(app).post('/api/v1/payments/webhooks/fake').set(hook.headers).send(hook.body.toString())).status).toBe(200);
  await drain();
  return ref;
}
/** Moves all of a user's periods back in time, keeping their lengths. */
const shiftPeriods = (userId: string, days: number) =>
  prisma.$executeRaw`UPDATE "subscription" SET "periodStart" = "periodStart" - make_interval(days => ${days}), "periodEnd" = "periodEnd" - make_interval(days => ${days}) WHERE "userId" = ${userId}`;

describe('pricing data comes from the backend catalogue', () => {
  it('in sandbox: plans are purchasable with prices; promotions are not (benefits not built in this step)', async () => {
    const res = await request(app).get('/api/v1/catalogue');
    expect(res.body.paymentsMode).toBe('sandbox');
    const find = (p: string, o: string) =>
      res.body.items.find((i: { product: string; option: string }) => i.product === p && i.option === o);
    expect(find('CREATOR_PLUS', 'MONTHLY')).toMatchObject({ purchasable: true, priceXaf: 1500, onSale: false });
    expect(find('PRO', 'ANNUAL')).toMatchObject({ purchasable: true, priceXaf: 30000, onSale: false });
    expect(res.body.plans.map((p: { key: string }) => p.key)).toEqual(['FREE', 'CREATOR_PLUS', 'PRO']);
    expect(res.body.plans[1].benefits.join(' ')).toMatch(/audio up to 100 MB/);
  });
  it('when payments are off nothing shows a price', async () => {
    const { configurePayments } = await import('../payments/runtime.js');
    configurePayments({ mode: 'off', provider: null });
    const res = await request(app).get('/api/v1/catalogue');
    expect(res.body.items.every((i: { purchasable: boolean; priceXaf: unknown }) => !i.purchasable && i.priceXaf === null)).toBe(true);
  });
});

describe('subscription purchase (TEST PROVIDER)', () => {
  it('a verified payment activates the right plan for the right period; receipt and notification follow', async () => {
    const u = await signUp(app);
    const ref = await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    const ent = await getEntitlements(u.userId);
    expect(ent.plan).toBe('CREATOR_PLUS');
    const order = await prisma.order.findUniqueOrThrow({ where: { reference: ref } });
    expect(new Date(ent.planUntil!).getTime() - order.paidAt!.getTime()).toBeLessThan(30 * 86_400_000 + 5_000);
    const receipt = await u.agent.get(`/api/v1/billing/orders/${ref}`);
    expect(receipt.body).toMatchObject({
      status: 'FULFILLED',
      amountXaf: 1500,
      mode: 'SANDBOX',
      provider: 'TEST PROVIDER',
      granted: { label: 'Creator Plus' },
    });
    const notes = await u.agent.get('/api/v1/notifications');
    expect(notes.body.items[0]).toMatchObject({
      type: 'payment.fulfilled',
      title: 'Test payment: payment confirmed',
      link: `/billing/orders/${ref}`,
    });
  });

  it.each(['failed', 'cancelled'])('a %s payment activates nothing', async (outcome) => {
    const u = await signUp(app);
    const ref = await buy(u.agent, 'PRO', 'MONTHLY', outcome);
    expect((await prisma.order.findUniqueOrThrow({ where: { reference: ref } })).status).toBe(outcome.toUpperCase());
    expect((await getEntitlements(u.userId)).plan).toBe('FREE');
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('upgrade starts now (no proration); downgrade waits; the preview says exactly that before paying', async () => {
    const u = await signUp(app);
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    const up = await u.agent.get('/api/v1/billing/preview?product=PRO&option=MONTHLY');
    expect(up.body).toMatchObject({ kind: 'upgrade', currentPlan: 'CREATOR_PLUS' });
    expect(up.body.note).toMatch(/No proration/);
    await buy(u.agent, 'PRO', 'MONTHLY');
    expect((await getEntitlements(u.userId)).plan).toBe('PRO');

    const down = await u.agent.get('/api/v1/billing/preview?product=CREATOR_PLUS&option=MONTHLY');
    expect(down.body.kind).toBe('downgrade');
    const proEnd = (await getEntitlements(u.userId)).planUntil!;
    // The earlier Plus month runs inside the Pro month, so the new Plus starts when Pro ends.
    expect(down.body.startsAt).toBe(proEnd);
    const renew = await u.agent.get('/api/v1/billing/preview?product=PRO&option=ANNUAL');
    expect(renew.body.kind).toBe('extend');
    expect(renew.body.startsAt).toBe(proEnd);
  });

  it('renewing the same plan extends from the current end date', async () => {
    const u = await signUp(app);
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    const firstEnd = (await getEntitlements(u.userId)).planUntil!;
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    const ent = await getEntitlements(u.userId);
    expect(new Date(ent.planUntil!).getTime() - new Date(firstEnd).getTime()).toBe(30 * 86_400_000);
  });

  it('expiry: paid entitlements end exactly at the boundary', async () => {
    const u = await signUp(app);
    await buy(u.agent, 'PRO', 'MONTHLY');
    const end = new Date((await getEntitlements(u.userId)).planUntil!);
    expect((await getEntitlements(u.userId, new Date(end.getTime() - 1))).plan).toBe('PRO');
    expect((await getEntitlements(u.userId, end)).limits).toEqual(FREE_LIMITS);
  });
});

describe('Creator Plus / Pro benefits are enforced where they apply', () => {
  const links = (count: number) => ({ links: Array.from({ length: count }, (_, i) => ({ url: `https://example.com/me/${i}` })) });

  it('profile links: Free 10, paid 20; lapsed extras are hidden publicly but never deleted', async () => {
    const u = await signUp(app);
    const tooMany = await u.agent.put('/api/v1/me/profile/links').set('Origin', ORIGIN).send(links(15));
    expect(tooMany.status).toBe(403);
    expect(tooMany.body.code).toBe('PLAN_LIMIT');
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    expect((await u.agent.put('/api/v1/me/profile/links').set('Origin', ORIGIN).send(links(15))).status).toBe(200);
    expect((await request(app).get(`/api/v1/profiles/${u.input.username}`)).body.links).toHaveLength(15);
    expect((await u.agent.put('/api/v1/me/profile/links').set('Origin', ORIGIN).send(links(21))).status).toBe(400);

    await shiftPeriods(u.userId, 31); // the plan has ended
    expect((await request(app).get(`/api/v1/profiles/${u.input.username}`)).body.links).toHaveLength(10);
    expect((await u.agent.get('/api/v1/me')).body.profile.links).toHaveLength(15);
    expect(await prisma.profileLink.count({ where: { profileId: u.userId } })).toBe(15);
  });

  it('profile accent: paid only; shown only while entitled', async () => {
    const u = await signUp(app);
    const free = await u.agent.patch('/api/v1/me/profile').set('Origin', ORIGIN).send({ accent: 'VIOLET' });
    expect(free.status).toBe(403);
    expect(free.body.code).toBe('PLAN_REQUIRED');
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    expect((await u.agent.patch('/api/v1/me/profile').set('Origin', ORIGIN).send({ accent: 'VIOLET' })).status).toBe(200);
    expect((await request(app).get(`/api/v1/profiles/${u.input.username}`)).body.accent).toBe('VIOLET');
    expect((await u.agent.patch('/api/v1/me/profile').set('Origin', ORIGIN).send({ accent: 'RED' })).status).toBe(400);
    await shiftPeriods(u.userId, 31);
    expect((await request(app).get(`/api/v1/profiles/${u.input.username}`)).body.accent).toBeNull();
    // Clearing is always allowed.
    expect((await u.agent.patch('/api/v1/me/profile').set('Origin', ORIGIN).send({ accent: null })).status).toBe(200);
  });

  it('audio uploads: Free 50 MB, paid 100 MB (the Cloudinary account cap); images and video unchanged', async () => {
    const u = await signUp(app);
    const upload = (kind: string, bytes: number) =>
      u.agent.post('/api/v1/media/uploads').set('Origin', ORIGIN).send({ kind, purpose: 'PORTFOLIO', bytes });
    expect((await upload('AUDIO', 80 * MB)).status).toBe(400);
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    expect((await upload('AUDIO', 80 * MB)).status).toBe(201);
    expect((await upload('AUDIO', 101 * MB)).status).toBe(400);
    expect((await upload('IMAGE', 11 * MB)).status).toBe(400);
    expect(PLAN_LIMITS.PRO.imageBytes).toBe(FREE_LIMITS.imageBytes);
  });
});

describe('managing a subscription', () => {
  it('cancel: benefits continue to the end date, confirmation shown, no reminders; buying again renews', async () => {
    const u = await signUp(app);
    const free = await u.agent.post('/api/v1/billing/subscription/cancel').set('Origin', ORIGIN);
    expect(free.status).toBe(409);
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    const res = await u.agent.post('/api/v1/billing/subscription/cancel').set('Origin', ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'CREATOR_PLUS', cancelled: true });
    expect((await getEntitlements(u.userId)).plan).toBe('CREATOR_PLUS');
    const notes = (await u.agent.get('/api/v1/notifications')).body.items;
    expect(notes[0]).toMatchObject({ type: 'subscription.cancelled', title: 'Cancellation confirmed' });

    await shiftPeriods(u.userId, 28); // 2 days left
    await subscriptionNoticesSweep();
    expect(await prisma.notification.count({ where: { userId: u.userId, type: 'subscription.expiring' } })).toBe(0);

    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    expect((await u.agent.get('/api/v1/billing/overview')).body.cancelled).toBe(false);
  });

  it('expiry notices: "ends soon" once, then "has ended" once', async () => {
    const u = await signUp(app);
    await buy(u.agent, 'PRO', 'MONTHLY');
    await shiftPeriods(u.userId, 28);
    await subscriptionNoticesSweep();
    await subscriptionNoticesSweep();
    expect(await prisma.notification.count({ where: { userId: u.userId, type: 'subscription.expiring' } })).toBe(1);
    await shiftPeriods(u.userId, 3);
    await subscriptionNoticesSweep();
    await subscriptionNoticesSweep();
    expect(await prisma.notification.count({ where: { userId: u.userId, type: 'subscription.ended' } })).toBe(1);
  });

  it('overview lists current, queued and ended periods; history lists own orders only', async () => {
    const u = await signUp(app);
    await buy(u.agent, 'PRO', 'MONTHLY');
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY'); // queued after Pro
    const o = (await u.agent.get('/api/v1/billing/overview')).body;
    expect(o.periods.map((p: { plan: string; state: string }) => `${p.plan}:${p.state}`).sort()).toEqual([
      'CREATOR_PLUS:queued',
      'PRO:current',
    ]);
    const other = await signUp(app);
    expect((await other.agent.get('/api/v1/billing/orders')).body.items).toHaveLength(0);
    const mine = (await u.agent.get('/api/v1/billing/orders')).body.items;
    expect(mine).toHaveLength(2);
    expect((await other.agent.get(`/api/v1/billing/orders/${mine[0].reference}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/billing/orders')).status).toBe(401);
  });
});

describe('notifications', () => {
  it('own only; unread count; mark read', async () => {
    const u = await signUp(app);
    const other = await signUp(app);
    await buy(u.agent, 'CREATOR_PLUS', 'MONTHLY');
    expect((await u.agent.get('/api/v1/notifications/unread-count')).body.count).toBe(1);
    expect((await other.agent.get('/api/v1/notifications')).body.items).toHaveLength(0);
    const id = (await u.agent.get('/api/v1/notifications')).body.items[0].id;
    expect(
      (
        await other.agent
          .post('/api/v1/notifications/read')
          .set('Origin', ORIGIN)
          .send({ ids: [id] })
      ).body.updated,
    ).toBe(0);
    expect((await u.agent.post('/api/v1/notifications/read').set('Origin', ORIGIN).send({ ids: 'all' })).body.updated).toBe(1);
    expect((await u.agent.get('/api/v1/notifications/unread-count')).body.count).toBe(0);
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});
