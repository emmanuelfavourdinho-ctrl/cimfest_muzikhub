import { Router } from 'express';
import { replaceLinksSchema, setProfileImageSchema, updateProfileSchema } from '@muzikhub/shared';
import { currentUserId, optionalAuth, requireAuth, requireFullAccess, viewerId } from '../../middleware/require-auth.js';
import { recordProfileView } from '../analytics/analytics.service.js';
import { validateBody } from '../../middleware/validate.js';
import * as profiles from './profiles.service.js';

/** /api/v1/me — the signed-in user's own account and profile. Always requires auth. */
export function meRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    res.json(await profiles.getMe(currentUserId(res.locals)));
  });

  router.patch('/profile', requireFullAccess, validateBody(updateProfileSchema), async (req, res) => {
    res.json(await profiles.updateProfile(currentUserId(res.locals), req.body));
  });

  router.put('/profile/links', requireFullAccess, validateBody(replaceLinksSchema), async (req, res) => {
    res.json(await profiles.replaceLinks(currentUserId(res.locals), req.body));
  });

  router.put('/profile/avatar', requireFullAccess, validateBody(setProfileImageSchema), async (req, res) => {
    res.json(await profiles.setProfileImage(currentUserId(res.locals), 'avatar', req.body.mediaId));
  });

  router.put('/profile/cover', requireFullAccess, validateBody(setProfileImageSchema), async (req, res) => {
    res.json(await profiles.setProfileImage(currentUserId(res.locals), 'cover', req.body.mediaId));
  });

  router.post('/onboarding/complete', async (_req, res) => {
    res.json(await profiles.completeOnboarding(currentUserId(res.locals)));
  });

  return router;
}

/** /api/v1/profiles — public profile pages. */
export function profilesRouter(): Router {
  const router = Router();

  router.get('/:username', optionalAuth, async (req, res) => {
    const profile = await profiles.getPublicProfile(String(req.params.username));
    // Analytics: a profile view, counted server-side (owner, bots and repeat views excluded).
    await recordProfileView(profile.username, {
      userId: viewerId(res.locals),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }).catch((e: Error) => console.warn('[analytics] profile view not recorded:', e.message));
    res.json(profile);
  });

  return router;
}
