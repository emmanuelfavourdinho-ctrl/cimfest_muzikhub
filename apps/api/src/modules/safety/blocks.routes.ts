import { Router } from 'express';
import { blockSchema } from '@muzikhub/shared';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { block, listBlocks, unblock } from './blocks.service.js';

/** /api/v1/blocks — your own block list (PROF-006, MSG-003). */
export function blocksRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (_req, res) => {
    res.json({ items: await listBlocks(currentUserId(res.locals)) });
  });
  router.post('/', validateBody(blockSchema), async (req, res) => {
    res.status(201).json(await block(currentUserId(res.locals), req.body.username));
  });
  router.delete('/:username', async (req, res) => {
    res.json(await unblock(currentUserId(res.locals), String(req.params.username)));
  });
  return router;
}
