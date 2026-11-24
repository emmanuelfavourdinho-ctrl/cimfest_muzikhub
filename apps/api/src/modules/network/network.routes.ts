import { Router } from 'express';
import { connectionListQuerySchema, createConnectionSchema, pageQuerySchema } from '@muzikhub/shared';
import { currentUserId, optionalAuth, requireAuth, requireFullAccess, viewerId } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as network from './network.service.js';
import { limits } from '../../lib/rate-limit.js';

/** /api/v1/users/:username/… — follow, follower lists, relationship state. */
export function usersRouter(): Router {
  const router = Router();
  const username = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.username);

  router.put('/:username/follow', requireAuth, limits.reaction, requireFullAccess, async (req, res) => {
    res.json(await network.follow(currentUserId(res.locals), username(req)));
  });
  router.delete('/:username/follow', requireAuth, limits.reaction, async (req, res) => {
    res.json(await network.unfollow(currentUserId(res.locals), username(req)));
  });
  router.get('/:username/followers', async (req, res) => {
    res.json(await network.listFollows(username(req), 'followers', parseQuery(pageQuerySchema, req.query)));
  });
  router.get('/:username/following', async (req, res) => {
    res.json(await network.listFollows(username(req), 'following', parseQuery(pageQuerySchema, req.query)));
  });
  router.get('/:username/relationship', optionalAuth, async (req, res) => {
    res.json(await network.relationship(viewerId(res.locals), username(req)));
  });
  return router;
}

/** /api/v1/connections — mutual connection requests. All require a session. */
export function connectionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const id = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

  router.get('/', async (req, res) => {
    const { filter, ...page } = parseQuery(connectionListQuerySchema, req.query);
    res.json(await network.listConnections(currentUserId(res.locals), filter, page));
  });
  router.post('/', limits.connectionRequest, requireFullAccess, validateBody(createConnectionSchema), async (req, res) => {
    res.status(201).json(await network.requestConnection(currentUserId(res.locals), req.body.username, req.body.message));
  });
  router.post('/:id/accept', requireFullAccess, async (req, res) => {
    res.json(await network.acceptConnection(currentUserId(res.locals), id(req)));
  });
  router.post('/:id/decline', async (req, res) => {
    res.json(await network.declineConnection(currentUserId(res.locals), id(req)));
  });
  router.post('/:id/cancel', async (req, res) => {
    res.json(await network.cancelConnection(currentUserId(res.locals), id(req)));
  });
  router.delete('/:id', async (req, res) => {
    res.json(await network.removeConnection(currentUserId(res.locals), id(req)));
  });
  return router;
}
