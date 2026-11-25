import request from 'supertest';
import { CATALOGUE_SEED, FREE_LIMITS } from '@muzikhub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { seedCatalogue } from './catalogue.service.js';
import { grantPromotion, grantSubscription } from './entitlements.js';

const app = testApp();
beforeEach(async () => {
  await resetDatabase();
  await seedCatalogue();
});

describe('public catalogue', () => {
  it('lists every product with no prices while nothing is on sale, and Free limits', async () => {
    const res = await request(app).get('/api/v1/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('XAF');
    expect(res.body.free.limits).toEqual(FREE_LIMITS);
    expect(res.body.items).toHaveLength(CATALOGUE_SEED.length);
    for (const item of res.body.items) expect(item).toMatchObject({ onSale: false, priceXaf: null });
  });

  it('seeding is idempotent and never changes an existing price', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    await admin.agent
      .post('/api/v1/admin/catalogue/price')
      .set('Origin', ORIGIN)
      .send({ product: 'PRO', option: 'MONTHLY', priceXaf: 3500, reason: 'Testing reseed' });
    expect(await seedCatalogue()).toBe(0);
    const rows = await admin.agent.get('/api/v1/admin/catalogue');
    expect(rows.body.items.find((r: { product: string; option: string }) => r.product === 'PRO' && r.option === 'MONTHLY').priceXaf).toBe(
      3500,
    );
  });
});

describe('admin price editing', () => {
  it('creates a new version, keeps the old row untouched, records who and why, and audits', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const before = await prisma.serviceCatalogue.findFirstOrThrow({ where: { product: 'POST_BOOST', option: 'DAYS_7' } });
    const res = await admin.agent
      .post('/api/v1/admin/catalogue/price')
      .set('Origin', ORIGIN)
      .send({ product: 'POST_BOOST', option: 'DAYS_7', priceXaf: 2000, reason: 'Launch promotion test' });
    expect(res.status).toBe(200);
    const row = res.body.items.find((r: { product: string; option: string }) => r.product === 'POST_BOOST' && r.option === 'DAYS_7');
    expect(row).toMatchObject({
      priceXaf: 2000,
      active: false,
      sellable: false,
      updatedBy: admin.input.name,
      reason: 'Launch promotion test',
    });

    const old = await prisma.serviceCatalogue.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.priceXaf).toBe(2500); // history is never rewritten
    expect(await prisma.serviceCatalogue.count({ where: { product: 'POST_BOOST', option: 'DAYS_7' } })).toBe(2);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'catalogue.price.change' } });
    expect(audit).toMatchObject({
      actorId: admin.userId,
      targetType: 'catalogue',
      targetId: 'POST_BOOST:DAYS_7',
      reason: 'Launch promotion test',
    });
    expect(audit.before).toEqual({ priceXaf: 2500, active: false });
    expect(audit.after).toEqual({ priceXaf: 2000, active: false });
  });

  it('validates: whole francs only, reason required, unknown fields rejected', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const send = (body: object) => admin.agent.post('/api/v1/admin/catalogue/price').set('Origin', ORIGIN).send(body);
    const base = { product: 'PRO', option: 'MONTHLY', reason: 'Valid reason' };
    expect((await send({ ...base, priceXaf: 2999.5 })).status).toBe(400);
    expect((await send({ ...base, priceXaf: 0 })).status).toBe(400);
    expect((await send({ product: 'PRO', option: 'MONTHLY', priceXaf: 3000 })).status).toBe(400);
    expect((await send({ ...base, priceXaf: 3000, active: true })).status).toBe(400);
    expect((await send({ ...base, option: 'DAYS_3', priceXaf: 3000 })).status).toBe(404); // PRO has no 3-day option
  });

  it('refuses to put a product on sale before its benefits are built (409), and audits nothing', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const res = await admin.agent
      .post('/api/v1/admin/catalogue/availability')
      .set('Origin', ORIGIN)
      .send({ product: 'CREATOR_PLUS', option: 'MONTHLY', active: true, reason: 'Try to sell early' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRODUCT_NOT_SELLABLE');
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'catalogue.' } } })).toBe(0);
    expect((await request(app).get('/api/v1/catalogue')).body.items.every((i: { priceXaf: unknown }) => i.priceXaf === null)).toBe(true);
  });

  it.each([
    ['signed out', 401],
    ['ordinary user', 403],
    ['moderator (wrong role)', 403],
  ] as const)('%s → %i on every catalogue admin endpoint', async (who, expected) => {
    const agent =
      who === 'signed out'
        ? request.agent(app)
        : who === 'ordinary user'
          ? (await signUp(app)).agent
          : (await makeStaff(app, 'MODERATOR')).agent;
    const calls = [
      agent.get('/api/v1/admin/catalogue'),
      agent
        .post('/api/v1/admin/catalogue/price')
        .set('Origin', ORIGIN)
        .send({ product: 'PRO', option: 'MONTHLY', priceXaf: 1, reason: 'Sneaky change' }),
      agent
        .post('/api/v1/admin/catalogue/availability')
        .set('Origin', ORIGIN)
        .send({ product: 'PRO', option: 'MONTHLY', active: false, reason: 'Sneaky change' }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(expected);
    expect(await prisma.serviceCatalogue.count()).toBe(CATALOGUE_SEED.length);
  });
});

describe('ownership policy: entitlements, subscriptions, promotions', () => {
  async function fixtures() {
    const owner = await signUp(app);
    const other = await signUp(app);
    const subscription = await prisma.$transaction((tx) => grantSubscription(tx, owner.userId, 'CREATOR_PLUS', 30));
    const promotion = await prisma.$transaction((tx) => grantPromotion(tx, owner.userId, 'PROFILE_SPOTLIGHT', owner.userId, 3));
    return { owner, other, subscription, promotion };
  }

  it('the owner reads their own entitlements and records', async () => {
    const { owner, subscription, promotion } = await fixtures();
    const e = await owner.agent.get('/api/v1/billing/entitlements');
    expect(e.status).toBe(200);
    expect(e.body.plan).toBe('CREATOR_PLUS');
    expect((await owner.agent.get(`/api/v1/billing/subscriptions/${subscription.id}`)).body).toMatchObject({
      id: subscription.id,
      plan: 'CREATOR_PLUS',
    });
    expect((await owner.agent.get(`/api/v1/billing/promotions/${promotion.id}`)).body).toMatchObject({
      id: promotion.id,
      product: 'PROFILE_SPOTLIGHT',
    });
  });

  it('anonymous → 401 everywhere', async () => {
    const { subscription, promotion } = await fixtures();
    for (const path of [
      '/api/v1/billing/entitlements',
      `/api/v1/billing/subscriptions/${subscription.id}`,
      `/api/v1/billing/promotions/${promotion.id}`,
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('wrong user → 404 (indistinguishable from a missing id), and their own entitlements stay Free', async () => {
    const { other, subscription, promotion } = await fixtures();
    const a = await other.agent.get(`/api/v1/billing/subscriptions/${subscription.id}`);
    const b = await other.agent.get(`/api/v1/billing/promotions/${promotion.id}`);
    const missing = await other.agent.get('/api/v1/billing/subscriptions/nope');
    expect([a.status, b.status, missing.status]).toEqual([404, 404, 404]);
    expect(a.body.detail).toBe(missing.body.detail);
    expect((await other.agent.get('/api/v1/billing/entitlements')).body.plan).toBe('FREE');
  });

  it('wrong role: a moderator cannot read billing records in the Admin Console; an admin can', async () => {
    const { subscription, promotion } = await fixtures();
    const mod = await makeStaff(app, 'MODERATOR');
    expect((await mod.agent.get(`/api/v1/admin/billing/subscriptions/${subscription.id}`)).status).toBe(403);
    expect((await mod.agent.get(`/api/v1/admin/billing/promotions/${promotion.id}`)).status).toBe(403);
    const admin = await makeStaff(app, 'ADMIN');
    expect((await admin.agent.get(`/api/v1/admin/billing/subscriptions/${subscription.id}`)).status).toBe(200);
    expect((await admin.agent.get(`/api/v1/admin/billing/promotions/${promotion.id}`)).status).toBe(200);
    expect((await admin.agent.get('/api/v1/admin/billing/promotions/nope')).status).toBe(404);
  });

  it('a staff member does not gain access to others’ records through the member endpoints', async () => {
    const { subscription } = await fixtures();
    const admin = await makeStaff(app, 'ADMIN');
    expect((await admin.agent.get(`/api/v1/billing/subscriptions/${subscription.id}`)).status).toBe(404);
  });
});

describe('public catalogue rate limit', () => {
  it('limits reads per caller (429 with Retry-After)', async () => {
    let last = await request(app).get('/api/v1/catalogue');
    for (let i = 0; i < 120 && last.status === 200; i += 1) last = await request(app).get('/api/v1/catalogue');
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeTruthy();
  });
});
