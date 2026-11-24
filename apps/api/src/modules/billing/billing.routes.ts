import { Router } from 'express';
import { assertCanReadBilling } from '../../lib/policy.js';
import { prisma } from '../../lib/prisma.js';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import type { StaffContext } from '../../middleware/require-staff.js';
import { currentRows, publicCatalogue } from './catalogue.service.js';
import { getEntitlements, previewSubscription } from './entitlements.js';
import { billingOverview, cancelSubscription } from './subscriptions.service.js';
import { ownPromotions, previewPromotion } from '../promotions/promotions.service.js';
import { ownOrders, ownReceipt } from '../payments/orders.service.js';
import { parseQuery } from '../../middleware/validate.js';
import { HttpError } from '../../lib/http-error.js';
import { z } from 'zod';

const previewQuery = z.object({ product: z.enum(['CREATOR_PLUS', 'PRO']), option: z.enum(['MONTHLY', 'ANNUAL']) });
const promotionPreviewQuery = z.object({
  product: z.enum(['POST_BOOST', 'PROFILE_SPOTLIGHT']),
  option: z.enum(['DAYS_3', 'DAYS_7', 'DAYS_14']),
  targetId: z.string().min(1).max(64).optional(),
});
const ordersQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

const toIso = <T extends { periodStart: Date; periodEnd: Date; createdAt: Date }>(r: T) => ({
  ...r,
  periodStart: r.periodStart.toISOString(),
  periodEnd: r.periodEnd.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

/** GET /api/v1/catalogue — public, read-only. Prices only for products that can be bought. */
export function catalogueRouter(): Router {
  const router = Router();
  router.get('/', limits.catalogueRead, async (_req, res) => {
    res.json(await publicCatalogue());
  });
  return router;
}

/** /api/v1/billing — the signed-in member's own entitlements and billing resources. */
export function billingRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/entitlements', async (_req, res) => {
    res.json(await getEntitlements(currentUserId(res.locals)));
  });
  router.get('/overview', async (_req, res) => {
    res.json(await billingOverview(currentUserId(res.locals)));
  });
  router.get('/preview', async (req, res) => {
    const q = parseQuery(previewQuery, req.query);
    const item = (await currentRows()).find((r) => r.product === q.product && r.option === q.option);
    if (!item) throw new HttpError(404, 'CATALOGUE_ITEM_NOT_FOUND', 'That plan option is not in the catalogue');
    res.json(await previewSubscription(currentUserId(res.locals), q.product, item.durationDays));
  });
  router.post('/subscription/cancel', async (_req, res) => {
    res.json(await cancelSubscription(currentUserId(res.locals)));
  });
  router.get('/promotions', async (_req, res) => {
    res.json({ items: await ownPromotions(currentUserId(res.locals)) });
  });
  router.get('/promotion-preview', async (req, res) => {
    const q = parseQuery(promotionPreviewQuery, req.query);
    res.json(await previewPromotion(currentUserId(res.locals), q.product, q.option, q.targetId));
  });
  router.get('/orders', async (req, res) => {
    res.json(await ownOrders(currentUserId(res.locals), parseQuery(ordersQuery, req.query)));
  });
  router.get('/orders/:reference', async (req, res) => {
    res.json(await ownReceipt(currentUserId(res.locals), String(req.params.reference)));
  });
  router.get('/subscriptions/:id', async (req, res) => {
    const row = await prisma.subscription.findUnique({ where: { id: String(req.params.id) } });
    res.json(toIso(assertCanReadBilling({ userId: currentUserId(res.locals) }, row, { notFound: 'Subscription not found' })));
  });
  router.get('/promotions/:id', async (req, res) => {
    const row = await prisma.promotion.findUnique({ where: { id: String(req.params.id) } });
    res.json(toIso(assertCanReadBilling({ userId: currentUserId(res.locals) }, row, { notFound: 'Promotion not found' })));
  });
  return router;
}

/** Staff read of any member's billing record (Admin Console; policy requires `billing.view`). */
export async function adminReadBilling(staff: StaffContext, kind: 'subscription' | 'promotion', id: string) {
  const row =
    kind === 'subscription'
      ? await prisma.subscription.findUnique({ where: { id } })
      : await prisma.promotion.findUnique({ where: { id } });
  return toIso(assertCanReadBilling(null, row, { staff, notFound: `${kind === 'subscription' ? 'Subscription' : 'Promotion'} not found` }));
}
