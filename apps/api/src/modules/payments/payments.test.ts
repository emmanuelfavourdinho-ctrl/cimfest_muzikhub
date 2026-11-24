import request from 'supertest';
import { PENDING_ORDER_CAP } from '@muzikhub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchOutbox } from '../../lib/outbox.js';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { testFulfiller, useSandboxPayments } from '../../test/payment-fixtures.js';
import { getEntitlements } from '../billing/entitlements.js';
import { assertTestItemAllowed, fulfilOrder, reconcilePayments, revenueSummary } from './orders.service.js';
import { FakePaymentProvider } from './providers/fake.js';
import { configurePayments } from './runtime.js';
import { ensureTestCatalogueItem, TEST_ITEM_PRICE_XAF } from './test-catalogue.js';

let fake: FakePaymentProvider;
let app: ReturnType<typeof testApp>;
let n = 0;
const key = () => `test-key-${Date.now()}-${(n += 1)}`;
const ITEM = { product: 'TEST_ITEM', option: 'DAYS_3' };

beforeEach(async () => {
  await resetDatabase();
  fake = useSandboxPayments();
  app = testApp();
  await ensureTestCatalogueItem();
});

async function member() {
  return signUp(app);
}
async function checkout(agent: ReturnType<typeof request.agent>, body: object = ITEM, idempotencyKey = key()) {
  return agent.post('/api/v1/checkout').set('Origin', ORIGIN).set('Idempotency-Key', idempotencyKey).send(body);
}
/** Runs outbox jobs until none are due (verify → fulfil). */
async function drain(now?: Date) {
  for (let i = 0; i < 10; i += 1) if ((await dispatchOutbox(now ? { now } : {})) === 0) return;
}
async function webhook(reference: string, type = 'payment.updated', eventId?: string) {
  const hook = fake.signedWebhook(reference, type, eventId);
  const res = await request(app).post('/api/v1/payments/webhooks/fake').set(hook.headers).send(hook.body.toString());
  return { res, hook };
}
const order = (reference: string) => prisma.order.findUniqueOrThrow({ where: { reference } });
/** Moves an order's clock back (createdAt and expiresAt together, keeping the CHECK). */
const age = (reference: string, minutes: number) =>
  prisma.$executeRaw`UPDATE "payment_order" SET "createdAt" = "createdAt" - make_interval(mins => ${minutes}), "expiresAt" = "expiresAt" - make_interval(mins => ${minutes}) WHERE "reference" = ${reference}`;

describe('checkout', () => {
  it('creates a SANDBOX order with a price snapshot and an opaque reference; sends only the email', async () => {
    const u = await member();
    const res = await checkout(u.agent);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'PENDING', amountXaf: TEST_ITEM_PRICE_XAF, currency: 'XAF', mode: 'SANDBOX' });
    expect(res.body.order.reference).toMatch(/^mh_[A-Za-z0-9_-]{22}$/);
    expect(res.body.order.reference).not.toContain(u.userId);
    expect(res.body.order.checkoutUrl).toContain('/dev/payments/checkout?reference=mh_');
    const o = await order(res.body.order.reference);
    expect(o.expiresAt.getTime() - o.createdAt.getTime()).toBe(3 * 3_600_000);
    // A later price change never touches this order.
    await prisma.serviceCatalogue.updateMany({ where: { testOnly: true }, data: { priceXaf: 99_999 } });
    expect((await order(o.reference)).amountXaf).toBe(TEST_ITEM_PRICE_XAF);
  });

  it('requires an Idempotency-Key', async () => {
    const u = await member();
    const res = await u.agent.post('/api/v1/checkout').set('Origin', ORIGIN).send(ITEM);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('same key + same body → the original order; same key + different body → 422', async () => {
    const u = await member();
    await ensureTestCatalogueItem({ option: 'DAYS_7' });
    const k = key();
    const first = await checkout(u.agent, ITEM, k);
    const again = await checkout(u.agent, ITEM, k);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.order.reference).toBe(first.body.order.reference);
    const other = await checkout(u.agent, { ...ITEM, option: 'DAYS_7' }, k);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.order.count()).toBe(1);
    expect(fake.calls.filter((c) => c.method === 'createCheckout')).toHaveLength(1);
  });

  it('reuses an open order for the same item instead of creating another (even with a new key, even concurrently)', async () => {
    const u = await member();
    const [a, b] = await Promise.all([checkout(u.agent), checkout(u.agent)]);
    const refs = new Set([a.body.order.reference, b.body.order.reference]);
    expect(refs.size).toBe(1);
    expect([a.body.reused, b.body.reused].sort()).toEqual([false, true]);
    expect(await prisma.order.count()).toBe(1);
  });

  it(`caps unfinished orders at ${PENDING_ORDER_CAP} per member; cancelled ones don't count`, async () => {
    const u = await member();
    const options = ['DAYS_3', 'DAYS_7', 'DAYS_14', 'MONTHLY'] as const;
    for (const option of options) await ensureTestCatalogueItem({ option });
    const made = [];
    for (const option of options.slice(0, 3)) made.push(await checkout(u.agent, { product: 'TEST_ITEM', option }));
    const fourth = await checkout(u.agent, { product: 'TEST_ITEM', option: 'MONTHLY' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.code).toBe('TOO_MANY_PENDING_ORDERS');
    await u.agent.post(`/api/v1/checkout/orders/${made[0]!.body.order.reference}/cancel`).set('Origin', ORIGIN);
    expect((await checkout(u.agent, { product: 'TEST_ITEM', option: 'MONTHLY' })).status).toBe(201);
  });

  it('refuses products that are not on sale (every real product today)', async () => {
    const u = await member();
    await prisma.serviceCatalogue.create({
      data: { product: 'POST_BOOST', option: 'DAYS_3', durationDays: 3, priceXaf: 1000, active: false },
    });
    const res = await checkout(u.agent, { product: 'POST_BOOST', option: 'DAYS_3' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE');
  });

  it('PAYMENTS_MODE=off rejects every checkout and the webhook route', async () => {
    configurePayments({ mode: 'off', provider: null });
    const u = await member();
    const res = await checkout(u.agent);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENTS_OFF');
    expect(await prisma.order.count()).toBe(0);
    const hook = await request(app).post('/api/v1/payments/webhooks/fake').set('content-type', 'application/json').send('{}');
    expect(hook.status).toBe(404);
  });

  it('a provider outage closes the order as FAILED; nothing is charged; a new key can try again', async () => {
    const u = await member();
    fake.failNextCheckout = true;
    const res = await checkout(u.agent);
    expect(res.status).toBe(502);
    expect((await prisma.order.findFirstOrThrow()).status).toBe('FAILED');
    expect((await checkout(u.agent)).status).toBe(201);
  });

  it('restricted accounts cannot start a payment', async () => {
    const u = await member();
    await prisma.user.update({ where: { id: u.userId }, data: { status: 'RESTRICTED' } });
    expect((await checkout(u.agent)).status).toBe(403);
  });
});

describe('test-only catalogue rows', () => {
  it('are hidden from the public catalogue and unreachable through the admin API', async () => {
    const pub = await request(app).get('/api/v1/catalogue');
    expect(JSON.stringify(pub.body)).not.toContain('TEST_ITEM');
    const admin = await makeStaff(app, 'ADMIN');
    const list = await admin.agent.get('/api/v1/admin/catalogue');
    expect(JSON.stringify(list.body)).not.toContain('TEST_ITEM');
    const edit = await admin.agent
      .post('/api/v1/admin/catalogue/price')
      .set('Origin', ORIGIN)
      .send({ product: 'TEST_ITEM', option: 'DAYS_3', priceXaf: 500, reason: 'Trying the test row' });
    expect(edit.status).toBe(400);
  });
  it('are refused in production (creation and purchase), and the database ties them to TEST_ITEM', async () => {
    await expect(ensureTestCatalogueItem({ option: 'DAYS_7' }, 'production')).rejects.toThrow(/refused in production/);
    expect(() => assertTestItemAllowed('production')).toThrow(/not available/);
    await expect(
      prisma.serviceCatalogue.create({ data: { product: 'POST_BOOST', option: 'DAYS_14', durationDays: 14, priceXaf: 1, testOnly: true } }),
    ).rejects.toThrow(/service_catalogue_test_only_check/);
    await expect(
      prisma.serviceCatalogue.create({ data: { product: 'TEST_ITEM', option: 'DAYS_14', durationDays: 14, priceXaf: 1 } }),
    ).rejects.toThrow(/service_catalogue_test_only_check/);
  });
});

describe('webhook → verification → fulfilment', () => {
  async function paidOrder() {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference as string;
    return { u, ref };
  }

  it('happy path: signed webhook → server-side verification → fulfilled once, entitlement granted', async () => {
    const { u, ref } = await paidOrder();
    fake.settle(ref, 'paid');
    const { res } = await webhook(ref, 'payment.complete');
    expect(res.status).toBe(200);
    expect((await order(ref)).status).toBe('PENDING'); // the webhook alone changes nothing
    await drain();
    const o = await order(ref);
    expect(o.status).toBe('FULFILLED');
    expect(o.paidAt).toBeTruthy();
    expect(await prisma.fulfilment.count({ where: { orderId: o.id } })).toBe(1);
    expect((await getEntitlements(u.userId)).plan).toBe('CREATOR_PLUS');
    expect(fake.calls.some((c) => c.method === 'getPayment' && c.reference === ref)).toBe(true);
    const events = await prisma.orderEvent.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.toStatus)).toEqual(['PENDING', 'FULFILMENT_PENDING', 'FULFILLED']);
  });

  it('a webhook saying "paid" is not trusted: if the provider says pending on verification, nothing happens', async () => {
    const { ref } = await paidOrder();
    await webhook(ref, 'payment.complete'); // fake still reports pending
    await drain();
    expect((await order(ref)).status).toBe('PENDING');
  });

  it('unknown provider status is treated as not paid', async () => {
    const { ref } = await paidOrder();
    fake.settle(ref, 'mystery-status');
    await webhook(ref);
    await drain();
    expect((await order(ref)).status).toBe('PENDING');
    expect(await prisma.fulfilment.count()).toBe(0);
  });

  it.each([
    ['amount', { amountXaf: TEST_ITEM_PRICE_XAF - 1 }],
    ['currency', { currency: 'EUR' }],
  ])('valid signature but %s mismatch → NEEDS_REVIEW, never fulfilled', async (_what, diff) => {
    const { u, ref } = await paidOrder();
    fake.settle(ref, 'paid', diff);
    await webhook(ref, 'payment.complete');
    await drain();
    const o = await order(ref);
    expect(o.status).toBe('NEEDS_REVIEW');
    expect(o.statusReason).toBe('mismatch');
    expect(await prisma.fulfilment.count()).toBe(0);
    expect((await getEntitlements(u.userId)).plan).toBe('FREE');
  });

  it('late success after our expiry → NEEDS_REVIEW, never fulfilled (also when already EXPIRED)', async () => {
    const { ref } = await paidOrder();
    await age(ref, 4 * 60);
    fake.settle(ref, 'paid');
    await webhook(ref, 'payment.complete');
    await drain();
    expect((await order(ref)).status).toBe('NEEDS_REVIEW');

    const second = await paidOrder();
    await age(second.ref, 4 * 60);
    await reconcilePayments(); // provider still pending → our TTL → EXPIRED
    expect((await order(second.ref)).status).toBe('EXPIRED');
    fake.settle(second.ref, 'paid');
    await webhook(second.ref, 'payment.complete');
    await drain();
    expect((await order(second.ref)).status).toBe('NEEDS_REVIEW');
    expect(await prisma.fulfilment.count()).toBe(0);
  });

  it('rejects bad signatures and tampered bodies; stores nothing', async () => {
    const { ref } = await paidOrder();
    const hook = fake.signedWebhook(ref);
    const tampered = hook.body.toString().replace(ref, `${ref.slice(0, -1)}x`);
    const a = await request(app).post('/api/v1/payments/webhooks/fake').set(hook.headers).send(tampered);
    const b = await request(app)
      .post('/api/v1/payments/webhooks/fake')
      .set({ ...hook.headers, 'x-test-provider-signature': 'v1=' + '0'.repeat(64) })
      .send(hook.body.toString());
    const c = await request(app).post('/api/v1/payments/webhooks/fake').set('content-type', 'application/json').send(hook.body.toString());
    expect([a.status, b.status, c.status]).toEqual([400, 400, 400]);
    expect(a.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('de-duplicates by event id: a replay is acknowledged and ignored', async () => {
    const { ref } = await paidOrder();
    const first = await webhook(ref, 'payment.complete', 'evt-fixed-1');
    const replay = await request(app).post('/api/v1/payments/webhooks/fake').set(first.hook.headers).send(first.hook.body.toString());
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { topic: 'payments.verify' } })).toBe(1);
  });

  it('webhook for an unknown reference: acknowledged, recorded as unmatched, nothing queued', async () => {
    const { res } = await webhook('mh_AAAAAAAAAAAAAAAAAAAAAA', 'payment.complete');
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({
      matchedOrder: false,
      orderReference: 'mh_AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('stores only id, type, reference and a body hash; no personal data or raw body', async () => {
    const { ref } = await paidOrder();
    const { hook } = await webhook(ref);
    const row = await prisma.webhookEvent.findFirstOrThrow();
    expect(Object.keys(row).sort()).toEqual(
      [
        'bodySha256',
        'id',
        'matchedOrder',
        'orderReference',
        'provider',
        'providerEventId',
        'receivedAt',
        'signatureVariant',
        'type',
      ].sort(),
    );
    expect(row.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.providerEventId).toBe(hook.eventId);
  });

  it('is exempt from the browser origin check (server-to-server), but checks content type and size', async () => {
    const { ref } = await paidOrder();
    const hook = fake.signedWebhook(ref);
    const fromAnywhere = await request(app)
      .post('/api/v1/payments/webhooks/fake')
      .set(hook.headers)
      .set('Origin', 'https://evil.example')
      .send(hook.body.toString());
    expect(fromAnywhere.status).toBe(200);
    const text = await request(app).post('/api/v1/payments/webhooks/fake').set('content-type', 'text/plain').send('hi');
    expect(text.status).toBe(415);
    const big = await request(app)
      .post('/api/v1/payments/webhooks/fake')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }));
    expect(big.status).toBe(413);
    // …while ordinary API writes still enforce it.
    const u = await member();
    expect(
      (await u.agent.post('/api/v1/checkout').set('Origin', 'https://evil.example').set('Idempotency-Key', key()).send(ITEM)).status,
    ).toBe(403);
  });

  it('fulfilment failure then retry: stays FULFILMENT_PENDING, then fulfils exactly once', async () => {
    const { u, ref } = await paidOrder();
    testFulfiller.failuresLeft = 2;
    fake.settle(ref, 'paid');
    await webhook(ref, 'payment.complete');
    await drain();
    expect((await order(ref)).status).toBe('FULFILMENT_PENDING');
    expect(await prisma.fulfilment.count()).toBe(0);
    const failing = await prisma.outboxEvent.findFirstOrThrow({ where: { topic: 'payments.fulfil' } });
    expect(failing.status).toBe('PENDING');
    expect(failing.lastError).toMatch(/simulated failure/);
    await drain(new Date(Date.now() + 60 * 60_000)); // retries become due
    const o = await order(ref);
    expect(o.status).toBe('FULFILLED');
    expect(testFulfiller.calls).toBe(3);
    // Re-running the job (e.g. after a crash) does nothing.
    expect((await fulfilOrder(o.id)).fulfilled).toBe(false);
    expect(await prisma.fulfilment.count()).toBe(1);
    expect(await prisma.subscription.count({ where: { userId: u.userId } })).toBe(1);
  });
});

describe('cancel and reconciliation', () => {
  it('the owner can cancel a pending order; the provider is told; a later success goes to review', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    const res = await u.agent.post(`/api/v1/checkout/orders/${ref}/cancel`).set('Origin', ORIGIN);
    expect(res.body.status).toBe('CANCELLED');
    expect(fake.calls.some((c) => c.method === 'cancelPayment')).toBe(true);
    expect((await u.agent.post(`/api/v1/checkout/orders/${ref}/cancel`).set('Origin', ORIGIN)).status).toBe(409);
  });

  it('picks up a lost webhook, ignores young orders, and is safe to run twice at once', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    fake.settle(ref, 'paid');
    expect((await reconcilePayments()).checked).toBe(0); // younger than the threshold: left to the webhook
    await age(ref, 5);
    const [a, b] = await Promise.all([reconcilePayments(), reconcilePayments()]);
    expect(a.changed + b.changed).toBe(1);
    await drain();
    expect((await order(ref)).status).toBe('FULFILLED');
    expect(await prisma.orderEvent.count({ where: { toStatus: 'FULFILMENT_PENDING' } })).toBe(1);
    expect(await prisma.fulfilment.count()).toBe(1);
  });

  it('applies failures and expiry with the same state machine', async () => {
    const u = await member();
    await ensureTestCatalogueItem({ option: 'DAYS_7' });
    const failed = (await checkout(u.agent)).body.order.reference;
    const stale = (await checkout(u.agent, { product: 'TEST_ITEM', option: 'DAYS_7' })).body.order.reference;
    fake.settle(failed, 'failed');
    await age(failed, 5);
    await age(stale, 4 * 60);
    const stats = await reconcilePayments();
    expect(stats).toMatchObject({ changed: 1, expired: 1, errors: 0 });
    expect((await order(failed)).status).toBe('FAILED');
    expect((await order(stale)).status).toBe('EXPIRED');
  });

  it('re-queues a stalled fulfilment that has no job waiting', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    fake.settle(ref, 'paid');
    await webhook(ref);
    await dispatchOutbox(); // verify only
    await prisma.outboxEvent.deleteMany({ where: { topic: 'payments.fulfil' } }); // as if the job was lost
    await prisma.$executeRaw`UPDATE "payment_order" SET "updatedAt" = now() - interval '20 minutes' WHERE "reference" = ${ref}`;
    expect((await reconcilePayments()).requeued).toBe(1);
    await drain();
    expect((await order(ref)).status).toBe('FULFILLED');
  });
});

describe('refunds (admin)', () => {
  async function fulfilled() {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference as string;
    fake.settle(ref, 'paid');
    await webhook(ref, 'payment.complete');
    await drain();
    return { u, ref };
  }

  it('refunds: audited, reason required, entitlement refunded, provider fee recorded as kept', async () => {
    const { u, ref } = await fulfilled();
    expect((await getEntitlements(u.userId)).plan).toBe('CREATOR_PLUS');
    const admin = await makeStaff(app, 'ADMIN');
    const noReason = await admin.agent.post(`/api/v1/admin/payments/orders/${ref}/refund`).set('Origin', ORIGIN).send({});
    expect(noReason.status).toBe(400);
    const res = await admin.agent
      .post(`/api/v1/admin/payments/orders/${ref}/refund`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Customer asked within 7 days' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUNDED');
    const o = await order(ref);
    expect(o).toMatchObject({
      status: 'REFUNDED',
      providerFeeRefunded: false,
      refundReason: 'Customer asked within 7 days',
      refundedById: admin.userId,
    });
    expect((await getEntitlements(u.userId)).plan).toBe('FREE');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'payment.refund' } });
    expect(audit.after).toMatchObject({ status: 'REFUNDED', providerFeeRefunded: false, entitlementsRefunded: 1 });
    const again = await admin.agent
      .post(`/api/v1/admin/payments/orders/${ref}/refund`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Clicked twice by mistake' });
    expect(again.status).toBe(409);
  });

  it('refusing when the provider does not support refunds: nothing changes', async () => {
    const { ref } = await fulfilled();
    const noRefunds = new FakePaymentProvider({ checkoutBaseUrl: 'http://localhost:5173/x', supportsRefund: false });
    configurePayments({ mode: 'sandbox', provider: noRefunds });
    const admin = await makeStaff(app, 'ADMIN');
    const res = await admin.agent
      .post(`/api/v1/admin/payments/orders/${ref}/refund`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Customer asked nicely' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFUND_NOT_SUPPORTED');
    expect((await order(ref)).status).toBe('FULFILLED');
    expect(await prisma.auditLog.count({ where: { action: 'payment.refund' } })).toBe(0);
  });

  it('a pending (unpaid) order cannot be refunded', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    const admin = await makeStaff(app, 'ADMIN');
    const res = await admin.agent
      .post(`/api/v1/admin/payments/orders/${ref}/refund`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Not paid yet though' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_NOT_REFUNDABLE');
  });
});

describe('revenue', () => {
  it('sandbox orders are excluded from revenue, forever', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    fake.settle(ref, 'paid');
    await webhook(ref);
    await drain();
    expect((await order(ref)).status).toBe('FULFILLED');
    expect(await revenueSummary()).toMatchObject({ liveRevenueXaf: 0, liveOrders: 0 });
    // A LIVE order (inserted directly: live mode is unreachable in code) is counted.
    const item = await prisma.serviceCatalogue.findFirstOrThrow({ where: { testOnly: true } });
    await prisma.order.create({
      data: {
        reference: 'mh_LIVEAAAAAAAAAAAAAAAAAA',
        userId: u.userId,
        mode: 'LIVE',
        provider: 'notchpay',
        catalogueId: item.id,
        product: item.product,
        option: item.option,
        durationDays: 3,
        amountXaf: 2500,
        idempotencyKey: 'live-row-1',
        requestHash: 'x',
        status: 'FULFILLED',
        paidAt: new Date(),
        fulfilledAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect(await revenueSummary()).toMatchObject({ liveRevenueXaf: 2500, liveOrders: 1 });
  });
});

describe('authorisation', () => {
  it('anonymous → 401 on every member payment endpoint', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    const anon = request(app);
    expect((await anon.post('/api/v1/checkout').set('Idempotency-Key', key()).send(ITEM)).status).toBe(401);
    expect((await anon.get(`/api/v1/checkout/orders/${ref}`)).status).toBe(401);
    expect((await anon.post(`/api/v1/checkout/orders/${ref}/cancel`)).status).toBe(401);
  });

  it('wrong user → 404 (same as a missing order); the owner sees only our own status', async () => {
    const owner = await member();
    const other = await member();
    const ref = (await checkout(owner.agent)).body.order.reference;
    expect((await other.agent.get(`/api/v1/checkout/orders/${ref}`)).status).toBe(404);
    expect((await other.agent.post(`/api/v1/checkout/orders/${ref}/cancel`).set('Origin', ORIGIN)).status).toBe(404);
    expect((await other.agent.get('/api/v1/checkout/orders/mh_missing')).status).toBe(404);
    const own = await owner.agent.get(`/api/v1/checkout/orders/${ref}`);
    expect(own.body).toMatchObject({ reference: ref, status: 'PENDING', statusMessage: 'Waiting for your payment.' });
    expect(own.body).not.toHaveProperty('userId');
  });

  it('wrong role: members and moderators can’t read payments or refund; admins can', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    const mod = await makeStaff(app, 'MODERATOR');
    for (const agent of [u.agent, mod.agent]) {
      expect((await agent.get('/api/v1/admin/payments/orders')).status).toBe(403);
      expect((await agent.get('/api/v1/admin/payments/summary')).status).toBe(403);
      expect(
        (await agent.post(`/api/v1/admin/payments/orders/${ref}/refund`).set('Origin', ORIGIN).send({ reason: 'Sneaky refund' })).status,
      ).toBe(403);
    }
    const admin = await makeStaff(app, 'ADMIN');
    const list = await admin.agent.get('/api/v1/admin/payments/orders?status=PENDING');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ reference: ref, mode: 'SANDBOX', user: { id: u.userId } });
  });
});

describe('development sandbox routes', () => {
  it('are mounted only in sandbox mode with the TEST PROVIDER', async () => {
    const u = await member();
    expect((await u.agent.get('/api/v1/dev/payments/status')).status).toBe(200);
    configurePayments({ mode: 'off', provider: null });
    const offApp = testApp();
    const v = await signUp(offApp);
    expect((await v.agent.get('/api/v1/dev/payments/status')).status).toBe(404);
  });

  it('drive the whole lifecycle through the real webhook pipeline', async () => {
    const u = await member();
    const ref = (await checkout(u.agent)).body.order.reference;
    const settle = await u.agent.post(`/api/v1/dev/payments/orders/${ref}/settle`).set('Origin', ORIGIN).send({ outcome: 'paid' });
    expect(settle.status).toBe(200);
    await drain();
    expect((await u.agent.get(`/api/v1/checkout/orders/${ref}`)).body.status).toBe('FULFILLED');
  });
});
