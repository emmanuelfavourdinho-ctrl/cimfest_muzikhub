import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  communityQuerySchema,
  createCommunitySchema,
  createDiscussionCommentSchema,
  createDiscussionSchema,
  discussionQuerySchema,
  inviteSchema,
  joinCommunitySchema,
  memberActionSchema,
  memberRoleSchema,
  moderationReasonSchema,
  updateCommunitySchema,
  updateDiscussionCommentSchema,
  updateDiscussionSchema,
} from '@muzikhub/shared';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, optionalAuth, requireAuth, requireFullAccess, viewerId } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as communities from './communities.service.js';
import * as discussions from './discussions.service.js';

const p = (req: Request, name: string) => String((req.params as Record<string, string>)[name]);
const membersQuery = z.object({
  status: z.enum(['ACTIVE', 'PENDING', 'INVITED', 'BANNED']).default('ACTIVE'),
  cursor: z.string().max(64).optional(),
});
const cursorQuery = z.object({ cursor: z.string().max(64).optional() });
const answerBody = z.strictObject({ commentId: z.string().max(64).nullable() });
const ownerBody = z.strictObject({});

/** /api/v1/communities — discovery, community pages, membership, and a community's discussions. */
export function communitiesRouter(): Router {
  const router = Router();
  router.get('/', optionalAuth, async (req, res) => {
    res.json(await communities.listCommunities(viewerId(res.locals), parseQuery(communityQuerySchema, req.query)));
  });
  router.get('/featured', optionalAuth, async (_req, res) => {
    res.json({ items: await communities.featuredCommunities(viewerId(res.locals)) });
  });
  router.get('/mine', requireAuth, async (_req, res) => {
    const userId = currentUserId(res.locals);
    res.json({ items: await communities.myCommunities(userId), recent: await discussions.recentForMember(userId) });
  });
  router.post('/', requireAuth, requireFullAccess, limits.contentWrite, validateBody(createCommunitySchema), async (req, res) => {
    res.status(201).json(await communities.createCommunity(currentUserId(res.locals), req.body));
  });
  router.get('/:slug', optionalAuth, async (req, res) => {
    res.json(await communities.communityDetail(p(req, 'slug'), viewerId(res.locals)));
  });
  router.patch('/:slug', requireAuth, requireFullAccess, validateBody(updateCommunitySchema), async (req, res) => {
    res.json(await communities.updateCommunity(currentUserId(res.locals), p(req, 'slug'), req.body));
  });
  router.delete('/:slug', requireAuth, async (req, res) => {
    res.json(await communities.archiveCommunity(currentUserId(res.locals), p(req, 'slug')));
  });

  router.post('/:slug/join', requireAuth, requireFullAccess, limits.apply, validateBody(joinCommunitySchema), async (req, res) => {
    res.json(await communities.joinCommunity(currentUserId(res.locals), p(req, 'slug'), req.body.note));
  });
  router.post('/:slug/leave', requireAuth, async (req, res) => {
    res.json(await communities.leaveCommunity(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post('/:slug/invitation/accept', requireAuth, requireFullAccess, async (req, res) => {
    res.json(await communities.acceptInvitation(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post('/:slug/invitation/decline', requireAuth, async (req, res) => {
    res.json(await communities.declineInvitation(currentUserId(res.locals), p(req, 'slug')));
  });
  router.post(
    '/:slug/invitations',
    requireAuth,
    requireFullAccess,
    limits.connectionRequest,
    validateBody(inviteSchema),
    async (req, res) => {
      res.status(201).json(await communities.invite(currentUserId(res.locals), p(req, 'slug'), req.body.username));
    },
  );

  router.get('/:slug/members', optionalAuth, async (req, res) => {
    const q = parseQuery(membersQuery, req.query);
    res.json(await communities.listMembers(viewerId(res.locals), p(req, 'slug'), q.status, q.cursor));
  });
  router.post('/:slug/members/:username/approve', requireAuth, async (req, res) => {
    res.json(await communities.decideRequest(currentUserId(res.locals), p(req, 'slug'), p(req, 'username'), true));
  });
  router.post('/:slug/members/:username/decline', requireAuth, async (req, res) => {
    res.json(await communities.decideRequest(currentUserId(res.locals), p(req, 'slug'), p(req, 'username'), false));
  });
  router.post('/:slug/members/:username/ban', requireAuth, validateBody(memberActionSchema), async (req, res) => {
    res.json(await communities.banMember(currentUserId(res.locals), p(req, 'slug'), p(req, 'username'), req.body.reason ?? null));
  });
  router.post('/:slug/members/:username/unban', requireAuth, async (req, res) => {
    res.json(await communities.unbanMember(currentUserId(res.locals), p(req, 'slug'), p(req, 'username')));
  });
  router.put('/:slug/members/:username/role', requireAuth, validateBody(memberRoleSchema), async (req, res) => {
    res.json(await communities.setRole(currentUserId(res.locals), p(req, 'slug'), p(req, 'username'), req.body.role));
  });
  router.post('/:slug/members/:username/owner', requireAuth, validateBody(ownerBody), async (req, res) => {
    res.json(await communities.transferOwnership(currentUserId(res.locals), p(req, 'slug'), p(req, 'username')));
  });

  router.get('/:slug/discussions', optionalAuth, async (req, res) => {
    res.json(await discussions.listDiscussions(viewerId(res.locals), p(req, 'slug'), parseQuery(discussionQuerySchema, req.query)));
  });
  router.post(
    '/:slug/discussions',
    requireAuth,
    requireFullAccess,
    limits.contentWrite,
    validateBody(createDiscussionSchema),
    async (req, res) => {
      res.status(201).json(await discussions.createDiscussion(currentUserId(res.locals), p(req, 'slug'), req.body));
    },
  );
  return router;
}

/** /api/v1/discussions — one discussion, its replies, reactions and community moderation. */
export function discussionsRouter(): Router {
  const router = Router();
  router.get('/:id', optionalAuth, async (req, res) => {
    res.json(await discussions.getDiscussion(viewerId(res.locals), p(req, 'id')));
  });
  router.patch('/:id', requireAuth, requireFullAccess, validateBody(updateDiscussionSchema), async (req, res) => {
    res.json(await discussions.updateDiscussion(currentUserId(res.locals), p(req, 'id'), req.body));
  });
  router.delete('/:id', requireAuth, async (req, res) => {
    res.json(await discussions.deleteDiscussion(currentUserId(res.locals), p(req, 'id')));
  });
  router.post('/:id/pin', requireAuth, async (req, res) => {
    res.json(await discussions.moderateDiscussion(currentUserId(res.locals), p(req, 'id'), 'pin'));
  });
  router.post('/:id/unpin', requireAuth, async (req, res) => {
    res.json(await discussions.moderateDiscussion(currentUserId(res.locals), p(req, 'id'), 'unpin'));
  });
  router.post('/:id/lock', requireAuth, async (req, res) => {
    res.json(await discussions.moderateDiscussion(currentUserId(res.locals), p(req, 'id'), 'lock'));
  });
  router.post('/:id/unlock', requireAuth, async (req, res) => {
    res.json(await discussions.moderateDiscussion(currentUserId(res.locals), p(req, 'id'), 'unlock'));
  });
  router.post('/:id/remove', requireAuth, validateBody(moderationReasonSchema), async (req, res) => {
    res.json(await discussions.moderateDiscussion(currentUserId(res.locals), p(req, 'id'), 'remove', req.body.reason));
  });
  router.put('/:id/helpful', requireAuth, requireFullAccess, limits.reaction, async (req, res) => {
    res.json(await discussions.setHelpful(currentUserId(res.locals), p(req, 'id'), true));
  });
  router.delete('/:id/helpful', requireAuth, limits.reaction, async (req, res) => {
    res.json(await discussions.setHelpful(currentUserId(res.locals), p(req, 'id'), false));
  });
  router.put('/:id/follow', requireAuth, async (req, res) => {
    res.json(await discussions.setFollow(currentUserId(res.locals), p(req, 'id'), true));
  });
  router.delete('/:id/follow', requireAuth, async (req, res) => {
    res.json(await discussions.setFollow(currentUserId(res.locals), p(req, 'id'), false));
  });
  router.post('/:id/answer', requireAuth, validateBody(answerBody), async (req, res) => {
    res.json(await discussions.acceptAnswer(currentUserId(res.locals), p(req, 'id'), req.body.commentId));
  });
  router.get('/:id/comments', optionalAuth, async (req, res) => {
    res.json(await discussions.listComments(viewerId(res.locals), p(req, 'id'), parseQuery(cursorQuery, req.query).cursor));
  });
  router.post(
    '/:id/comments',
    requireAuth,
    requireFullAccess,
    limits.contentWrite,
    validateBody(createDiscussionCommentSchema),
    async (req, res) => {
      res.status(201).json(await discussions.addComment(currentUserId(res.locals), p(req, 'id'), req.body.body, req.body.parentId));
    },
  );
  return router;
}

/** /api/v1/community-comments — edit, delete or (moderators) remove one reply. */
export function communityCommentsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.patch('/:id', requireFullAccess, validateBody(updateDiscussionCommentSchema), async (req, res) => {
    res.json(await discussions.updateComment(currentUserId(res.locals), p(req, 'id'), req.body.body));
  });
  router.delete('/:id', async (req, res) => {
    res.json(await discussions.deleteComment(currentUserId(res.locals), p(req, 'id')));
  });
  router.post('/:id/remove', validateBody(moderationReasonSchema), async (req, res) => {
    res.json(await discussions.removeComment(currentUserId(res.locals), p(req, 'id'), req.body.reason));
  });
  return router;
}
