import { Router } from 'express';
import { z } from 'zod';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import { listNotifications, markRead, unreadCount } from './notifications.service.js';

const listQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const readBody = z.strictObject({ ids: z.union([z.array(z.string().max(64)).max(100), z.literal('all')]) });

/** /api/v1/notifications — your own notifications only. */
export function notificationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    res.json(await listNotifications(currentUserId(res.locals), parseQuery(listQuery, req.query)));
  });
  router.get('/unread-count', async (_req, res) => {
    res.json({ count: await unreadCount(currentUserId(res.locals)) });
  });
  router.post('/read', validateBody(readBody), async (req, res) => {
    res.json(await markRead(currentUserId(res.locals), req.body.ids));
  });
  return router;
}
