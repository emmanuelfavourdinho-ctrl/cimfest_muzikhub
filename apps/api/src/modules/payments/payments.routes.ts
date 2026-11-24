import { Router } from 'express';
import { z } from 'zod';
import { BILLING_PRODUCT_KEYS, CATALOGUE_OPTION_KEYS, startCheckoutSchema } from '@muzikhub/shared';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, requireAuth, requireFullAccess } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { cancelOwnOrder, ownOrder, startCheckout, toOrderView } from './orders.service.js';
import { FakePaymentProvider } from './providers/fake.js';
import { paymentsRuntime } from './runtime.js';
import { receiveWebhook } from './webhook.js';
import { ensureTestCatalogueItem } from './test-catalogue.js';

const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Outside production the body may also name TEST_ITEM (test-only catalogue rows). In production
 * the schema is the shared one, so TEST_ITEM is a validation error before any lookup.
 */
const checkoutBody =
  env.NODE_ENV === 'production'
    ? startCheckoutSchema
    : z.strictObject({ product: z.enum([...BILLING_PRODUCT_KEYS, 'TEST_ITEM']), option: z.enum(CATALOGUE_OPTION_KEYS) });

/** /api/v1/checkout — start and follow your own orders. No checkout screens yet (Phase 6). */
export function checkoutRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.post('/', requireFullAccess, limits.checkout, validateBody(checkoutBody), async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Starting a payment needs an Idempotency-Key header.');
    if (!KEY_FORMAT.test(key))
      throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8–128 letters, digits or _ . : -');
    const user = res.locals.session!.user;
    const result = await startCheckout({ id: user.id, email: user.email }, req.body, key);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.created ? 201 : 200).json({ order: result.order, reused: result.reused });
  });
  router.get('/orders/:reference', async (req, res) => {
    res.json(await ownOrder(currentUserId(res.locals), String(req.params.reference)));
  });
  router.post('/orders/:reference/cancel', async (req, res) => {
    res.json(await cancelOwnOrder(currentUserId(res.locals), String(req.params.reference)));
  });
  return router;
}

const settleSchema = z.strictObject({ outcome: z.enum(['paid', 'processing', 'failed', 'cancelled', 'expired']) });

/**
 * /api/v1/dev/payments — DEVELOPMENT ONLY. Mounted only when devSandboxEnabled() (not
 * production, PAYMENTS_MODE=sandbox, TEST PROVIDER). Plays the provider's part for the sandbox
 * page: "pay" on the fake hosted page, then deliver a correctly signed webhook through the real
 * webhook pipeline (verify → de-duplicate → outbox → server-side verification → fulfilment).
 */
export function devPaymentsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/status', async (_req, res) => {
    const item = await prisma.serviceCatalogue.findFirst({ where: { testOnly: true }, orderBy: { createdAt: 'desc' } });
    res.json({
      mode: paymentsRuntime().mode,
      provider: 'TEST PROVIDER',
      testItem: item && { product: item.product, option: item.option, priceXaf: item.priceXaf },
    });
  });
  router.post('/test-item', async (_req, res) => {
    const item = await ensureTestCatalogueItem();
    res.status(201).json({ product: item.product, option: item.option, priceXaf: item.priceXaf });
  });
  router.post('/orders/:reference/settle', validateBody(settleSchema), async (req, res) => {
    const provider = paymentsRuntime().provider;
    if (!(provider instanceof FakePaymentProvider)) throw new HttpError(404, 'NOT_FOUND', 'Not available');
    const order = await prisma.order.findUnique({ where: { reference: String(req.params.reference) } });
    if (!order || order.userId !== currentUserId(res.locals)) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    provider.settle(order.reference, req.body.outcome);
    const hook = provider.signedWebhook(order.reference, `payment.${req.body.outcome}`);
    await receiveWebhook(provider.name, hook.body, hook.headers);
    res.json(toOrderView(order));
  });
  return router;
}
