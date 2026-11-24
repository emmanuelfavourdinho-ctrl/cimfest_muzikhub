import { Router } from 'express';
import { createUploadSchema } from '@muzikhub/shared';
import { currentUserId, requireAuth, requireFullAccess } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import * as media from './media.service.js';

/** /api/v1/media — signed direct uploads to Cloudinary. */
export function mediaRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/uploads', requireFullAccess, validateBody(createUploadSchema), async (req, res) => {
    res.status(201).json(await media.createUpload(currentUserId(res.locals), req.body));
  });

  router.post('/:id/confirm', requireFullAccess, async (req, res) => {
    res.json(await media.confirmUpload(currentUserId(res.locals), String(req.params.id)));
  });

  router.delete('/:id', async (req, res) => {
    await media.deleteOwnAsset(currentUserId(res.locals), req.params.id);
    res.status(204).end();
  });

  return router;
}
