import { Router, type Request } from 'express';
import {
  cancelCompetitionSchema,
  competitionInputSchema,
  competitionQuerySchema,
  disputeSchema,
  disqualifySchema,
  entryInputSchema,
  extendSchema,
  judgeSchema,
  scoreSchema,
  updateCompetitionSchema,
} from '@muzikhub/shared';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, optionalAuth, requireAuth, requireFullAccess, viewerId } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as comp from './competitions.service.js';

const p = (req: Request, name: string) => String((req.params as Record<string, string>)[name]);

/** /api/v1/competitions — discovery, organiser workflows, entries, judging, results, disputes. */
export function competitionsRouter(): Router {
  const router = Router();
  router.get('/', optionalAuth, async (req, res) => {
    res.json(await comp.listCompetitions(viewerId(res.locals), parseQuery(competitionQuerySchema, req.query)));
  });
  router.post('/', requireAuth, requireFullAccess, limits.contentWrite, validateBody(competitionInputSchema), async (req, res) => {
    res.status(201).json(await comp.createCompetition(currentUserId(res.locals), req.body));
  });
  router.get('/:slug', optionalAuth, async (req, res) => {
    res.json(await comp.competitionDetail(p(req, 'slug'), viewerId(res.locals)));
  });
  router.patch('/:slug', requireAuth, requireFullAccess, validateBody(updateCompetitionSchema), async (req, res) => {
    res.json(await comp.updateCompetition(currentUserId(res.locals), p(req, 'slug'), req.body));
  });
  router.post('/:slug/publish', requireAuth, requireFullAccess, async (req, res) => {
    res.json(await comp.publishCompetition(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post('/:slug/extend', requireAuth, requireFullAccess, validateBody(extendSchema), async (req, res) => {
    res.json(await comp.extendCompetition(currentUserId(res.locals), p(req, 'slug'), new Date(req.body.until), req.body.reason));
  });
  router.post('/:slug/cancel', requireAuth, validateBody(cancelCompetitionSchema), async (req, res) => {
    res.json(await comp.cancelCompetition(currentUserId(res.locals), p(req, 'slug'), req.body.reason));
  });
  router.post('/:slug/judges', requireAuth, requireFullAccess, validateBody(judgeSchema), async (req, res) => {
    res.json(await comp.addJudge(currentUserId(res.locals), p(req, 'slug'), req.body.username));
  });
  router.delete('/:slug/judges/:username', requireAuth, async (req, res) => {
    res.json(await comp.removeJudge(currentUserId(res.locals), p(req, 'slug'), p(req, 'username')));
  });
  router.get('/:slug/entry', requireAuth, async (req, res) => {
    res.json(await comp.myEntry(currentUserId(res.locals), p(req, 'slug')));
  });
  router.put('/:slug/entry', requireAuth, requireFullAccess, limits.apply, validateBody(entryInputSchema), async (req, res) => {
    res.json(await comp.submitEntry(currentUserId(res.locals), p(req, 'slug'), req.body));
  });
  router.delete('/:slug/entry', requireAuth, async (req, res) => {
    res.json(await comp.withdrawEntry(currentUserId(res.locals), p(req, 'slug')));
  });
  router.get('/:slug/entries', requireAuth, async (req, res) => {
    res.json(await comp.listEntries(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post('/:slug/results', requireAuth, requireFullAccess, async (req, res) => {
    res.json(await comp.publishResults(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post('/:slug/disputes', requireAuth, requireFullAccess, limits.report, validateBody(disputeSchema), async (req, res) => {
    res.status(201).json(await comp.openDispute(currentUserId(res.locals), p(req, 'slug'), req.body.reason));
  });
  return router;
}

/** /api/v1/competition-entries — judging actions on one entry. */
export function competitionEntriesRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.put('/:id/score', requireFullAccess, validateBody(scoreSchema), async (req, res) => {
    res.json(await comp.scoreEntry(currentUserId(res.locals), p(req, 'id'), req.body.scores, req.body.feedback));
  });
  router.post('/:id/disqualify', validateBody(disqualifySchema), async (req, res) => {
    res.json(await comp.disqualifyEntry(currentUserId(res.locals), p(req, 'id'), req.body.reason));
  });
  return router;
}
