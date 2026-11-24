import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  adminContentQuerySchema,
  adminReportsQuerySchema,
  adminUsersQuerySchema,
  assignReportSchema,
  auditQuerySchema,
  can,
  FRESH_SESSION_MINUTES,
  MODERATION_TARGETS,
  ORDER_STATUSES,
  resolveDisputeSchema,
  BILLING_PRODUCT_KEYS,
  CATALOGUE_OPTION_KEYS,
  moderationActionSchema,
  PERMISSIONS,
  grantOrganiserSchema,
  changePriceSchema,
  setAvailabilitySchema,
  reasonOnlySchema,
  reportNoteSchema,
  resolveReportSchema,
  setAccountStatusSchema,
  setRoleSchema,
  type ModerationTarget,
  type Permission,
} from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import { assertCan, assertFreshSession, requirePermission, requireStaff, staffOf } from '../../middleware/require-staff.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as moderation from './moderation.service.js';
import { overview } from './overview.service.js';
import * as reports from './reports.service.js';
import * as users from './users.service.js';
import { setOrganiser } from '../opportunities/opportunities.service.js';
import * as catalogue from '../billing/catalogue.service.js';
import { adminReadBilling } from '../billing/billing.routes.js';
import * as payments from '../payments/orders.service.js';
import * as promotions from '../promotions/promotions.service.js';
import * as competitions from '../competitions/competitions.service.js';

const adminOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  mode: z.enum(['SANDBOX', 'LIVE']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const historyQuerySchema = z.object({ product: z.enum(BILLING_PRODUCT_KEYS), option: z.enum(CATALOGUE_OPTION_KEYS) });

const param = (req: Request, name: string) => String((req.params as Record<string, string>)[name]);

export const adminReadLimit = rateLimit({ name: 'admin-read', windowMs: 60_000, max: 240 });
export const adminWriteLimit = rateLimit({ name: 'admin-write', windowMs: 60_000, max: 60 });

/** /api/v1/admin — every route: session → staff (role from DB, ACTIVE, 2FA) → permission. */
export function adminRouter(): Router {
  const router = Router();

  /**
   * Who am I in the Admin Console? Works before 2FA is set up, so the console can guide a new
   * staff member through enrolment. Reveals nothing beyond the caller's own role.
   */
  router.get('/me', requireAuth, async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUserId(res.locals) },
      select: { platformRole: true, status: true, twoFactorEnabled: true },
    });
    const isStaff = can(user.platformRole, 'admin.access');
    const createdAt = new Date(res.locals.session!.session.createdAt);
    res.json({
      isStaff,
      role: isStaff ? user.platformRole : null,
      accountActive: user.status === 'ACTIVE',
      twoFactorEnabled: user.twoFactorEnabled,
      permissions: isStaff ? (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.platformRole, p)) : [],
      freshUntil: new Date(createdAt.getTime() + FRESH_SESSION_MINUTES * 60_000).toISOString(),
    });
  });

  router.use(requireAuth, requireStaff, adminReadLimit);
  router.use((req, _res, next) => (req.method === 'GET' ? next() : adminWriteLimit(req, _res, next)));

  router.get('/overview', async (_req, res) => {
    res.json(await overview(staffOf(res.locals)));
  });

  // ── Users ──
  router.get('/users', requirePermission('users.view'), async (req, res) => {
    res.json(await users.listUsers(staffOf(res.locals), parseQuery(adminUsersQuerySchema, req.query)));
  });
  router.get('/users/:id', requirePermission('users.view'), async (req, res) => {
    res.json(await users.getUser(staffOf(res.locals), param(req, 'id')));
  });
  router.post('/users/:id/status', validateBody(setAccountStatusSchema), async (req, res) => {
    res.json(await users.setAccountStatus(staffOf(res.locals), param(req, 'id'), req.body));
  });
  router.post('/users/:id/role', validateBody(setRoleSchema), async (req, res) => {
    res.json(await users.setRole(staffOf(res.locals), param(req, 'id'), req.body.role, req.body.reason));
  });
  router.post('/users/:id/reset-two-factor', validateBody(reasonOnlySchema), async (req, res) => {
    res.json(await users.resetTwoFactor(staffOf(res.locals), param(req, 'id'), req.body.reason));
  });
  // D7: organiser capability (opportunities, competitions). ADMIN only, reason required, audited.
  router.post('/users/:id/organiser', requirePermission('organisers.grant'), validateBody(grantOrganiserSchema), async (req, res) => {
    const staff = staffOf(res.locals);
    res.json(await setOrganiser({ id: staff.id, role: staff.role, ip: staff.ip }, param(req, 'id'), req.body.grant, req.body.reason));
  });

  // ── Reports ──
  router.get('/reports', async (req, res) => {
    res.json(await reports.listReports(staffOf(res.locals), parseQuery(adminReportsQuerySchema, req.query)));
  });
  router.get('/reports/:id', async (req, res) => {
    res.json(await reports.getReport(staffOf(res.locals), param(req, 'id')));
  });
  router.post('/reports/:id/assign', validateBody(assignReportSchema), async (req, res) => {
    res.json(await reports.assignReport(staffOf(res.locals), param(req, 'id'), req.body.assignee));
  });
  router.post('/reports/:id/notes', validateBody(reportNoteSchema), async (req, res) => {
    res.status(201).json(await reports.addNote(staffOf(res.locals), param(req, 'id'), req.body.body));
  });
  router.post('/reports/:id/escalate', validateBody(reasonOnlySchema), async (req, res) => {
    res.json(await reports.escalateReport(staffOf(res.locals), param(req, 'id'), req.body.reason));
  });
  router.post('/reports/:id/resolve', validateBody(resolveReportSchema), async (req, res) => {
    res.json(await reports.closeReport(staffOf(res.locals), param(req, 'id'), 'RESOLVED', req.body.resolution, req.body.includeRelated));
  });
  router.post('/reports/:id/dismiss', validateBody(resolveReportSchema), async (req, res) => {
    res.json(await reports.closeReport(staffOf(res.locals), param(req, 'id'), 'DISMISSED', req.body.resolution, req.body.includeRelated));
  });

  // ── Content moderation ──
  const moderationTarget = (req: Request): ModerationTarget => {
    const type = param(req, 'type');
    if (!(MODERATION_TARGETS as readonly string[]).includes(type)) throw new HttpError(404, 'NOT_FOUND', 'Unknown content type');
    return type as ModerationTarget;
  };
  router.get('/content', async (req, res) => {
    res.json(await moderation.listContent(staffOf(res.locals), parseQuery(adminContentQuerySchema, req.query)));
  });
  router.post('/content/:type/:id/remove', validateBody(moderationActionSchema), async (req, res) => {
    res.json(
      await moderation.removeContent(staffOf(res.locals), moderationTarget(req), param(req, 'id'), req.body.reason, req.body.reportId),
    );
  });
  router.post('/content/:type/:id/restore', validateBody(reasonOnlySchema), async (req, res) => {
    res.json(await moderation.restoreContent(staffOf(res.locals), moderationTarget(req), param(req, 'id'), req.body.reason));
  });

  // ── Pricing catalogue (administrators; ADR 0004) ──
  router.get('/catalogue', requirePermission('pricing.manage'), async (_req, res) => {
    res.json({ items: await catalogue.adminCatalogue() });
  });
  router.get('/catalogue/history', requirePermission('pricing.manage'), async (req, res) => {
    const q = parseQuery(historyQuerySchema, req.query);
    res.json({ items: await catalogue.priceHistory(q.product, q.option) });
  });
  router.post('/catalogue/price', requirePermission('pricing.manage'), validateBody(changePriceSchema), async (req, res) => {
    const b = req.body;
    res.json({ items: await catalogue.changePrice(staffOf(res.locals), b.product, b.option, b.priceXaf, b.reason) });
  });
  router.post('/catalogue/availability', requirePermission('pricing.manage'), validateBody(setAvailabilitySchema), async (req, res) => {
    const b = req.body;
    res.json({ items: await catalogue.setAvailability(staffOf(res.locals), b.product, b.option, b.active, b.reason) });
  });

  // ── Billing records (read-only; central policy in lib/policy.ts) ──
  router.get('/billing/subscriptions/:id', async (req, res) => {
    res.json(await adminReadBilling(staffOf(res.locals), 'subscription', param(req, 'id')));
  });
  router.get('/billing/promotions/:id', async (req, res) => {
    res.json(await adminReadBilling(staffOf(res.locals), 'promotion', param(req, 'id')));
  });

  // ── Payments (Phase 3: read + refund; management screens in Phase 6) ──
  router.get('/payments/summary', requirePermission('billing.view'), async (_req, res) => {
    res.json(await payments.revenueSummary());
  });
  router.get('/payments/orders', requirePermission('billing.view'), async (req, res) => {
    const q = parseQuery(adminOrdersQuerySchema, req.query);
    res.json(await payments.adminOrders(q));
  });
  router.get('/payments/orders/:reference', requirePermission('billing.view'), async (req, res) => {
    res.json(await payments.adminOrderDetail(param(req, 'reference')));
  });
  router.post(
    '/payments/orders/:reference/recheck',
    requirePermission('payments.repair'),
    validateBody(reasonOnlySchema),
    async (req, res) => {
      res.json(await payments.adminRecheck(staffOf(res.locals), param(req, 'reference'), req.body.reason));
    },
  );
  router.post(
    '/payments/orders/:reference/retry-fulfilment',
    requirePermission('payments.repair'),
    validateBody(reasonOnlySchema),
    async (req, res) => {
      res.json(await payments.adminRetryFulfilment(staffOf(res.locals), param(req, 'reference'), req.body.reason));
    },
  );
  router.post(
    '/payments/orders/:reference/approve-late',
    requirePermission('payments.repair'),
    validateBody(reasonOnlySchema),
    async (req, res) => {
      const staff = staffOf(res.locals);
      assertFreshSession(staff);
      res.json(await payments.adminApproveLate(staff, param(req, 'reference'), req.body.reason));
    },
  );
  router.post(
    '/payments/orders/:reference/refund',
    requirePermission('payments.refund'),
    validateBody(reasonOnlySchema),
    async (req, res) => {
      const staff = staffOf(res.locals);
      assertFreshSession(staff);
      res.json(await payments.refundOrder(staff, param(req, 'reference'), req.body.reason));
    },
  );

  // ── Promotions (moderation can end them early) ──
  router.get('/promotions', requirePermission('content.moderate'), async (req, res) => {
    res.json({ items: await promotions.adminPromotions(req.query.state === 'all' ? 'all' : 'running') });
  });
  router.post('/promotions/:id/end', requirePermission('content.moderate'), validateBody(reasonOnlySchema), async (req, res) => {
    res.json(await promotions.endPromotion(staffOf(res.locals), param(req, 'id'), req.body.reason));
  });

  // ── Competition disputes (D9: an ADMIN decides; recorded and audited) ──
  router.get('/competition-disputes', requirePermission('competitions.disputes'), async (req, res) => {
    const status =
      req.query.status === 'UPHELD' || req.query.status === 'REJECTED' || req.query.status === 'OPEN' ? req.query.status : undefined;
    res.json(await competitions.listDisputes(status));
  });
  router.post(
    '/competition-disputes/:id/resolve',
    requirePermission('competitions.disputes'),
    validateBody(resolveDisputeSchema),
    async (req, res) => {
      res.json(await competitions.resolveDispute(staffOf(res.locals), param(req, 'id'), req.body.outcome, req.body.resolution));
    },
  );

  // ── Audit log (administrators) ──
  router.get('/audit', async (req, res) => {
    const staff = staffOf(res.locals);
    assertCan(staff, 'audit.view');
    const q = parseQuery(auditQuerySchema, req.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action && { action: { startsWith: q.action } }),
      ...(q.targetType && { targetType: q.targetType }),
      ...(q.targetId && { targetId: q.targetId }),
      ...(q.actorId && { actorId: q.actorId }),
    };
    const page = await paginate(q, (args) =>
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...args }),
    );
    const actorIds = [...new Set(page.items.map((a) => a.actorId).filter((x): x is string => Boolean(x)))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, username: true } });
    const byId = new Map(actors.map((a) => [a.id, { name: a.name, username: a.username }]));
    res.json({
      nextCursor: page.nextCursor,
      items: page.items.map((a) => ({ ...users.toAuditView(a), actor: a.actorId ? (byId.get(a.actorId) ?? null) : null })),
    });
  });

  return router;
}
