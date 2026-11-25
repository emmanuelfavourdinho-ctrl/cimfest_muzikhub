import { Router } from 'express';
import { z } from 'zod';
import {
  createPortfolioSchema,
  pageQuerySchema,
  PORTFOLIO_STATUSES,
  publishPortfolioSchema,
  updatePortfolioSchema,
} from '@muzikhub/shared';
import {
  currentUserId,
  optionalAuth,
  requireAuth,
  requireFullAccess,
  requireVerifiedEmail,
  viewerId,
} from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as portfolio from './portfolio.service.js';
import { limits } from '../../lib/rate-limit.js';

const ownListQuery = pageQuerySchema.extend({ status: z.enum(PORTFOLIO_STATUSES).optional() });

/** /api/v1/portfolio — create and manage portfolio items; view a single item. */
export function portfolioRouter(): Router {
  const router = Router();

  router.get('/:id', optionalAuth, async (req, res) => {
    res.json(await portfolio.getItem(String(req.params.id), viewerId(res.locals)));
  });

  router.post('/', requireAuth, limits.contentWrite, requireFullAccess, validateBody(createPortfolioSchema), async (req, res) => {
    res.status(201).json(await portfolio.createItem(currentUserId(res.locals), req.body));
  });

  router.patch('/:id', requireAuth, limits.contentWrite, requireFullAccess, validateBody(updatePortfolioSchema), async (req, res) => {
    res.json(await portfolio.updateItem(currentUserId(res.locals), String(req.params.id), req.body));
  });

  router.post(
    '/:id/publish',
    requireAuth,
    limits.contentWrite,
    requireFullAccess,
    requireVerifiedEmail,
    validateBody(publishPortfolioSchema),
    async (req, res) => {
      res.json(await portfolio.publishItem(currentUserId(res.locals), String(req.params.id), req.body.shareToFeed));
    },
  );

  router.post('/:id/archive', requireAuth, async (req, res) => {
    res.json(await portfolio.archiveItem(currentUserId(res.locals), String(req.params.id)));
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    await portfolio.deleteItem(currentUserId(res.locals), String(req.params.id));
    res.status(204).end();
  });

  return router;
}

/** GET /api/v1/me/portfolio — the owner's studio list (all statuses). */
export function ownPortfolioRoute(): Router {
  const router = Router();
  router.get('/', requireAuth, async (req, res) => {
    const { status, ...page } = parseQuery(ownListQuery, req.query);
    res.json(await portfolio.listOwnPortfolio(currentUserId(res.locals), status, page));
  });
  return router;
}

/** GET /api/v1/profiles/:username/portfolio */
export function profilePortfolioRoute(): Router {
  const router = Router({ mergeParams: true });
  router.get('/', optionalAuth, async (req, res) => {
    const params = req.params as { username: string };
    res.json(await portfolio.listProfilePortfolio(params.username, viewerId(res.locals), parseQuery(pageQuerySchema, req.query)));
  });
  return router;
}
