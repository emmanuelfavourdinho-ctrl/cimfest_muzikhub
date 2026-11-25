import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchOutbox } from '../../lib/outbox.js';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { testFulfiller, useSandboxPayments } from '../../test/payment-fixtures.js';
import { seedCatalogue } from '../billing/catalogue.service.js';
import { reconcilePayments } from './orders.service.js';
import type { FakePaymentProvider } from './providers/fake.js';
import { ensureTestCatalogueItem } from './test-catalogue.js';

let fake: FakePaymentProvider;
let app: ReturnType<typeof testApp>;
let n = 0;
beforeEach(async () => {
  await resetDatabase();
  fake = useSandboxPayments();
  app = testApp();
  await ensureTestCatalogueItem();
});
const drain = async (now?: Date) => {
  for (let i = 0; i < 10; i += 1) if ((await dispatchOutbox(now ? { now } : {})) === 0) return;
};
async function order() {
  const u = await signUp(app);
  const res = await u.agent
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', `ops-${Date.now()}-${(n += 1)}`)
    .send({ product: 'TEST_ITEM', option: 'DAYS_3' });
  return { u, ref: res.body.order.reference as string };
}
const status = async (ref: string) => (await prisma.order.findUniqueOrThrow({ where: { reference: ref } })).status;
const post = (agent: ReturnType<typeof request.agent>, path: string, reason = 'Checked with the provider') =>
  agent.post(`/api/v1/admin/payments/orders/${path}`).set('Origin', ORIGIN).send({ reason });

describe('admin payment operations', () => {
  it('detail and lists are for billing.view (admins); moderators and members are refused', async () => {
    const { u, ref } = await order();
    const mod = await makeStaff(app, 'MODERATOR');
    for (const agent of [u.agent, mod.agent]) {
      expect((await agent.get(`/api/v1/admin/payments/orders/${ref}`)).status).toBe(403);
      expect((await post(agent, `${ref}/recheck`)).status).toBe(403);
    }
    const admin = await makeStaff(app, 'ADMIN');
    const detail = await admin.agent.get(`/api/v1/admin/payments/orders/${ref}`);
    expect(detail.body).toMatchObject({
      reference: ref,
      mode: 'SANDBOX',
      provider: 'TEST PROVIDER',
      status: 'PENDING',
      actions: { recheck: true, refund: false },
    });
    expect(detail.body.history[0]).toMatchObject({ to: 'PENDING', trigger: 'member.checkout' });
    expect((await admin.agent.get('/api/v1/admin/payments/orders?mode=LIVE')).body.items).toEqual([]);
    expect((await admin.agent.get('/api/v1/admin/payments/orders?mode=SANDBOX')).body.items).toHaveLength(1);
  });

  it('re-check applies the provider’s answer through the state machine, with a reason, audited', async () => {
    const { ref } = await order();
    fake.settle(ref, 'paid');
    const admin = await makeStaff(app, 'ADMIN');
    expect((await admin.agent.post(`/api/v1/admin/payments/orders/${ref}/recheck`).set('Origin', ORIGIN).send({})).status).toBe(400);
    const res = await post(admin.agent, `${ref}/recheck`, 'Customer says they paid');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FULFILMENT_PENDING');
    await drain();
    expect(await status(ref)).toBe('FULFILLED');
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'payment.recheck' } })).toMatchObject({
      targetId: ref,
      reason: 'Customer says they paid',
    });
  });

  it('retry fulfilment for a paid order whose job ran out, without duplicating', async () => {
    const { ref } = await order();
    testFulfiller.failuresLeft = 100;
    fake.settle(ref, 'paid');
    const hook = fake.signedWebhook(ref);
    await request(app).post('/api/v1/payments/webhooks/fake').set(hook.headers).send(hook.body.toString());
    await drain();
    await prisma.outboxEvent.deleteMany({ where: { topic: 'payments.fulfil' } }); // as if it gave up
    testFulfiller.failuresLeft = 0;
    const admin = await makeStaff(app, 'ADMIN');
    expect((await post(admin.agent, `${ref}/retry-fulfilment`, 'Fulfiller fixed')).status).toBe(200);
    expect((await post(admin.agent, `${ref}/retry-fulfilment`, 'Clicked twice')).status).toBe(200);
    await drain();
    expect(await status(ref)).toBe('FULFILLED');
    expect(await prisma.fulfilment.count()).toBe(1);
    expect((await post(admin.agent, `${ref}/retry-fulfilment`, 'Too late now')).status).toBe(409);
  });

  it('approve-late: only a late success the provider re-confirms now; never a mismatch', async () => {
    const late = await order();
    await prisma.$executeRaw`UPDATE "payment_order" SET "createdAt" = "createdAt" - interval '4 hours', "expiresAt" = "expiresAt" - interval '4 hours' WHERE "reference" = ${late.ref}`;
    fake.settle(late.ref, 'paid');
    await reconcilePayments();
    expect((await prisma.order.findUniqueOrThrow({ where: { reference: late.ref } })).statusReason).toBe('paid_late');

    const mismatch = await order();
    fake.settle(mismatch.ref, 'paid', { amountXaf: 1 });
    await prisma.$executeRaw`UPDATE "payment_order" SET "createdAt" = "createdAt" - interval '5 minutes' WHERE "reference" = ${mismatch.ref}`;
    await reconcilePayments();
    expect(await status(mismatch.ref)).toBe('NEEDS_REVIEW');

    const admin = await makeStaff(app, 'ADMIN');
    const list = await admin.agent.get('/api/v1/admin/payments/orders?status=NEEDS_REVIEW');
    expect(list.body.items).toHaveLength(2);
    expect((await post(admin.agent, `${mismatch.ref}/approve-late`, 'Looks fine to me')).body.code).toBe('NOT_APPROVABLE');

    fake.settle(late.ref, 'refunded'); // provider no longer confirms
    expect((await post(admin.agent, `${late.ref}/approve-late`, 'Customer paid in time')).body.code).toBe('NOT_VERIFIED');
    fake.settle(late.ref, 'paid');
    const ok = await post(admin.agent, `${late.ref}/approve-late`, 'Customer paid in time');
    expect(ok.status).toBe(200);
    await drain();
    expect(await status(late.ref)).toBe('FULFILLED');
    expect(await prisma.auditLog.count({ where: { action: 'payment.approve_late', targetId: late.ref } })).toBe(1);
  });

  it('price history lists every version with who and why', async () => {
    await seedCatalogue();
    const admin = await makeStaff(app, 'ADMIN');
    await admin.agent
      .post('/api/v1/admin/catalogue/price')
      .set('Origin', ORIGIN)
      .send({ product: 'PRO', option: 'MONTHLY', priceXaf: 3500, reason: 'Testing history' });
    const h = await admin.agent.get('/api/v1/admin/catalogue/history?product=PRO&option=MONTHLY');
    expect(h.body.items.map((v: { priceXaf: number }) => v.priceXaf)).toEqual([3500, 3000]);
    expect(h.body.items[0]).toMatchObject({ updatedBy: expect.any(String), reason: 'Testing history' });
    const mod = await makeStaff(app, 'MODERATOR');
    expect((await mod.agent.get('/api/v1/admin/catalogue/history?product=PRO&option=MONTHLY')).status).toBe(403);
  });
});
