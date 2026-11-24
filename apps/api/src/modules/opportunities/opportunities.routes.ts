import { Router, type Request } from 'express';
import {
  applicationDecisionSchema,
  applySchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  pageQuerySchema,
  updateOpportunitySchema,
} from '@muzikhub/shared';
import { limits } from '../../lib/rate-limit.js';
import { idempotent } from '../../middleware/idempotency.js';
import { currentUserId, optionalAuth, requireAuth, requireFullAccess, viewerId } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as opps from './opportunities.service.js';

const id = (req: Request) => String(req.params.id);

/** /api/v1/opportunities — FR-34..37. */
export function opportunitiesRouter(): Router {
  const router = Router();
  router.get('/', optionalAuth, async (req, res) => {
    res.json(await opps.listOpportunities(viewerId(res.locals), parseQuery(listOpportunitiesQuerySchema, req.query)));
  });
  router.get('/mine', requireAuth, async (req, res) => {
    res.json(await opps.listMine(currentUserId(res.locals), parseQuery(pageQuerySchema, req.query)));
  });
  router.get('/organiser-status', requireAuth, async (_req, res) => {
    res.json(await opps.organiserStatus(currentUserId(res.locals)));
  });
  router.get('/:id', optionalAuth, async (req, res) => {
    res.json(await opps.getOpportunity(viewerId(res.locals), id(req)));
  });
  router.post(
    '/',
    requireAuth,
    limits.contentWrite,
    requireFullAccess,
    validateBody(createOpportunitySchema),
    idempotent(),
    async (req, res) => {
      res.status(201).json(await opps.createOpportunity(currentUserId(res.locals), req.body));
    },
  );
  router.patch('/:id', requireAuth, limits.contentWrite, requireFullAccess, validateBody(updateOpportunitySchema), async (req, res) => {
    res.json(await opps.updateOpportunity(currentUserId(res.locals), id(req), req.body));
  });
  router.post('/:id/publish', requireAuth, limits.contentWrite, requireFullAccess, async (req, res) => {
    res.json(await opps.publishOpportunity(currentUserId(res.locals), id(req), req.ip ?? null));
  });
  router.post('/:id/close', requireAuth, requireFullAccess, async (req, res) => {
    res.json(await opps.closeOpportunity(currentUserId(res.locals), id(req), req.ip ?? null));
  });
  router.post('/:id/apply', requireAuth, limits.apply, requireFullAccess, validateBody(applySchema), idempotent(), async (req, res) => {
    res.status(201).json(await opps.apply(currentUserId(res.locals), id(req), req.body.message));
  });
  router.post('/:id/withdraw', requireAuth, requireFullAccess, async (req, res) => {
    res.json(await opps.withdraw(currentUserId(res.locals), id(req)));
  });
  router.get('/:id/applications', requireAuth, async (req, res) => {
    res.json(await opps.listApplications(currentUserId(res.locals), id(req), parseQuery(pageQuerySchema, req.query)));
  });
  return router;
}

/** /api/v1/applications — organiser decisions on applications. */
export function applicationsRouter(): Router {
  const router = Router();
  router.post('/:id/status', requireAuth, requireFullAccess, validateBody(applicationDecisionSchema), async (req, res) => {
    res.json(await opps.decide(currentUserId(res.locals), id(req), req.body.status, req.ip ?? null));
  });
  return router;
}
