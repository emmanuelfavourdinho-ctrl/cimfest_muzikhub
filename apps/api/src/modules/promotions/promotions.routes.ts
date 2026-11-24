import { Router } from 'express';
import { optionalAuth, viewerId } from '../../middleware/require-auth.js';
import { promotedPosts, spotlight } from './promotions.service.js';

/** /api/v1/promoted — the paid, labelled places. Separate from organic lists and their paging. */
export function promotedRouter(): Router {
  const router = Router();
  router.use(optionalAuth);
  router.get('/posts', async (_req, res) => {
    res.json({ items: await promotedPosts(viewerId(res.locals)) });
  });
  router.get('/spotlight', async (_req, res) => {
    res.json({ people: await spotlight() });
  });
  return router;
}
