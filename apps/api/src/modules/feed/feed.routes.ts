import { Router } from 'express';
import { createCommentSchema, createPostSchema, feedQuerySchema, pageQuerySchema, updatePostSchema } from '@muzikhub/shared';
import {
  currentUserId,
  optionalAuth,
  requireAuth,
  requireFullAccess,
  requireVerifiedEmail,
  viewerId,
} from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as feed from './feed.service.js';
import { limits } from '../../lib/rate-limit.js';

const id = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

/** GET /api/v1/feed?tab=discover|following */
export function feedRouter(): Router {
  const router = Router();
  router.get('/', optionalAuth, async (req, res) => {
    const { tab, ...page } = parseQuery(feedQuerySchema, req.query);
    res.json(await feed.feed(viewerId(res.locals), tab, page));
  });
  return router;
}

/** /api/v1/posts — create, view, edit, delete, like, comment. */
export function postsRouter(): Router {
  const router = Router();

  router.post(
    '/',
    requireAuth,
    limits.contentWrite,
    requireFullAccess,
    requireVerifiedEmail,
    validateBody(createPostSchema),
    async (req, res) => {
      res.status(201).json(await feed.createPost(currentUserId(res.locals), req.body));
    },
  );
  router.get('/:id', optionalAuth, async (req, res) => {
    res.json(await feed.getPost(id(req), viewerId(res.locals)));
  });
  router.patch('/:id', requireAuth, limits.contentWrite, requireFullAccess, validateBody(updatePostSchema), async (req, res) => {
    res.json(await feed.updatePost(currentUserId(res.locals), id(req), req.body.body));
  });
  router.delete('/:id', requireAuth, async (req, res) => {
    await feed.deletePost(currentUserId(res.locals), id(req));
    res.status(204).end();
  });

  router.put('/:id/like', requireAuth, limits.reaction, requireFullAccess, async (req, res) => {
    res.json(await feed.setLike(currentUserId(res.locals), id(req), true));
  });
  router.delete('/:id/like', requireAuth, limits.reaction, async (req, res) => {
    res.json(await feed.setLike(currentUserId(res.locals), id(req), false));
  });

  router.get('/:id/comments', optionalAuth, async (req, res) => {
    res.json(await feed.listComments(id(req), viewerId(res.locals), parseQuery(pageQuerySchema, req.query)));
  });
  router.post(
    '/:id/comments',
    requireAuth,
    limits.contentWrite,
    requireFullAccess,
    requireVerifiedEmail,
    validateBody(createCommentSchema),
    async (req, res) => {
      res.status(201).json(await feed.addComment(currentUserId(res.locals), id(req), req.body.body));
    },
  );
  return router;
}

/** DELETE /api/v1/comments/:id */
export function commentsRouter(): Router {
  const router = Router();
  router.delete('/:id', requireAuth, async (req, res) => {
    await feed.deleteComment(currentUserId(res.locals), id(req));
    res.status(204).end();
  });
  return router;
}

/** GET /api/v1/profiles/:username/posts */
export function profilePostsRoute(): Router {
  const router = Router({ mergeParams: true });
  router.get('/', optionalAuth, async (req, res) => {
    const username = String((req.params as { username?: string }).username);
    res.json(await feed.profilePosts(username, viewerId(res.locals), parseQuery(pageQuerySchema, req.query)));
  });
  return router;
}
