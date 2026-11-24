import { Router } from 'express';
import { assertCanReadBilling } from '../../lib/policy.js';
import { prisma } from '../../lib/prisma.js';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import type { StaffContext } from '../../middleware/require-staff.js';
import { publicCatalogue } from './catalogue.service.js';
import { getEntitlements } from './entitlements.js';

const toIso = <T extends { periodStart: Date; periodEnd: Date; createdAt: Date }>(r: T) => ({
  ...r,
  periodStart: r.periodStart.toISOString(),
  periodEnd: r.periodEnd.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

/** GET /api/v1/catalogue — public, read-only. Prices only for products that can be bought. */
export function catalogueRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
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
