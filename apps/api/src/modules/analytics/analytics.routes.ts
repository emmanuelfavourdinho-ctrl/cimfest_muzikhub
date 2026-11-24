import { Router } from 'express';
import { z } from 'zod';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, optionalAuth, requireAuth, viewerId } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import { analyticsItems, analyticsSummary, recordEvent } from './analytics.service.js';

const eventBody = z.strictObject({
  event: z.enum(['PLAY', 'LINK_CLICK']), // profile views are recorded by the server itself
  subjectType: z.enum(['PORTFOLIO_ITEM', 'POST', 'PROFILE_LINK']),
  subjectId: z.string().min(1).max(64),
});
const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** /api/v1/analytics */
export function analyticsRouter(): Router {
  const router = Router();
  // Public (signed-out listeners count too). Always 204: the response never says whether it counted.
  router.post('/events', optionalAuth, limits.analyticsEvent, validateBody(eventBody), async (req, res) => {
    await recordEvent(req.body.event, req.body.subjectType, req.body.subjectId, {
      userId: viewerId(res.locals),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(204).end();
  });
  router.get('/summary', requireAuth, async (req, res) => {
    res.json(await analyticsSummary(currentUserId(res.locals), parseQuery(rangeQuery, req.query).days));
  });
  router.get('/items', requireAuth, async (req, res) => {
    res.json(await analyticsItems(currentUserId(res.locals), parseQuery(rangeQuery, req.query).days));
  });
  return router;
}
