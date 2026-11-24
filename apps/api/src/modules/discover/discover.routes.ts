import { Router } from 'express';
import { discoverPeopleQuerySchema, discoverWorkQuerySchema } from '@muzikhub/shared';
import { optionalAuth, viewerId } from '../../middleware/require-auth.js';
import { parseQuery } from '../../middleware/validate.js';
import * as discover from './discover.service.js';

/** /api/v1/discover — public; signed-in viewers also get "following" flags. */
export function discoverRouter(): Router {
  const router = Router();
  router.use(optionalAuth);
  router.get('/people', async (req, res) => {
    res.json(await discover.discoverPeople(viewerId(res.locals), parseQuery(discoverPeopleQuerySchema, req.query)));
  });
  router.get('/work', async (req, res) => {
    res.json(await discover.discoverWork(viewerId(res.locals), parseQuery(discoverWorkQuerySchema, req.query)));
  });
  return router;
}
