import { Router, type Request } from 'express';
import {
  answerSchema,
  clarifySchema,
  collaborationNoteSchema,
  collaborationStatusSchema,
  createCollabRequestSchema,
  requestBoxQuerySchema,
  respondSchema,
} from '@muzikhub/shared';
import { limits } from '../../lib/rate-limit.js';
import { idempotent } from '../../middleware/idempotency.js';
import { currentUserId, requireAuth, requireFullAccess } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as collab from './collaboration.service.js';

const p = (req: Request, name: string) => String((req.params as Record<string, string>)[name]);

/** /api/v1/collaborations — requests and the accepted collaborations (participants only). */
export function collaborationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/requests', async (req, res) => {
    const q = parseQuery(requestBoxQuerySchema, req.query);
    res.json(await collab.listRequests(currentUserId(res.locals), q.box, q.cursor));
  });
  router.post(
    '/requests',
    requireFullAccess,
    limits.connectionRequest,
    validateBody(createCollabRequestSchema),
    idempotent(),
    async (req, res) => {
      res.status(201).json(await collab.createRequest(currentUserId(res.locals), req.body));
    },
  );
  router.get('/requests/:id', async (req, res) => {
    res.json(await collab.getRequest(currentUserId(res.locals), p(req, 'id')));
  });
  router.post('/requests/:id/accept', requireFullAccess, validateBody(respondSchema), async (req, res) => {
    res.json(await collab.actOnRequest(currentUserId(res.locals), p(req, 'id'), 'accept', req.body.note));
  });
  router.post('/requests/:id/decline', validateBody(respondSchema), async (req, res) => {
    res.json(await collab.actOnRequest(currentUserId(res.locals), p(req, 'id'), 'decline', req.body.note));
  });
  router.post('/requests/:id/clarify', requireFullAccess, validateBody(clarifySchema), async (req, res) => {
    res.json(await collab.actOnRequest(currentUserId(res.locals), p(req, 'id'), 'clarify', req.body.question));
  });
  router.post('/requests/:id/answer', requireFullAccess, validateBody(answerSchema), async (req, res) => {
    res.json(await collab.actOnRequest(currentUserId(res.locals), p(req, 'id'), 'answer', req.body.answer));
  });
  router.post('/requests/:id/cancel', async (req, res) => {
    res.json(await collab.actOnRequest(currentUserId(res.locals), p(req, 'id'), 'cancel'));
  });
  router.get('/', async (_req, res) => {
    res.json(await collab.listCollaborations(currentUserId(res.locals)));
  });
  router.get('/:id', async (req, res) => {
    res.json(await collab.getCollaboration(currentUserId(res.locals), p(req, 'id')));
  });
  router.post('/:id/status', requireFullAccess, validateBody(collaborationStatusSchema), async (req, res) => {
    res.json(await collab.setCollaborationStatus(currentUserId(res.locals), p(req, 'id'), req.body.status, req.body.note));
  });
  router.post('/:id/notes', requireFullAccess, limits.contentWrite, validateBody(collaborationNoteSchema), async (req, res) => {
    res.status(201).json(await collab.addNote(currentUserId(res.locals), p(req, 'id'), req.body.body));
  });
  return router;
}
