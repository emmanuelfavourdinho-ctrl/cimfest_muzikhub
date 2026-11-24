import { createPostSchema, type CommentView, type FeedTab, type Page, type PageQuery, type PostView } from '@muzikhub/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { mapPage, paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { releaseAssets, requireAttachable, toMediaView } from '../media/media.service.js';
import { portfolioInclude, publiclyVisible, toPortfolioView } from '../portfolio/portfolio.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { requireActiveUser } from '../network/network.service.js';
import { visibleUser } from '../../lib/account-status.js';

type CreatePost = z.output<typeof createPostSchema>;

/** A post is visible when its author is active and any showcased work is still public. */
const visiblePost = {
  author: visibleUser,
  removedAt: null,
  OR: [{ portfolioItemId: null }, { portfolioItem: publiclyVisible }],
} satisfies Prisma.PostWhereInput;

const postInclude = (viewer: string | null) =>
  ({
    author: { select: personSelect },
    media: { include: { asset: true }, orderBy: { position: 'asc' } },
    portfolioItem: { include: portfolioInclude },
    _count: { select: { likes: true, comments: { where: { removedAt: null } } } },
    // Only the viewer's own like row, to compute likedByMe without loading all likes.
    likes: { where: { userId: viewer ?? '__nobody__' }, select: { userId: true } },
  }) satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

function toPostView(post: PostRow, viewer: string | null): PostView {
  return {
    id: post.id,
    type: post.type,
    body: post.body,
    author: toPerson(post.author),
    media: post.media.map((m) => toMediaView(m.asset)),
    portfolioItem: post.portfolioItem ? toPortfolioView(post.portfolioItem, viewer) : null,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    likedByMe: post.likes.length > 0,
    isAuthor: viewer === post.authorId,
    createdAt: post.createdAt.toISOString(),
    editedAt: post.editedAt?.toISOString() ?? null,
  };
}

const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.PostOrderByWithRelationInput[];

/** Loads a post the viewer may see, or 404. */
async function requireVisiblePost(postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, ...visiblePost }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  return post;
}

export async function createPost(authorId: string, input: CreatePost): Promise<PostView> {
  const id = await prisma.$transaction(async (tx) => {
    const assets = await Promise.all(input.mediaIds.map((mediaId) => requireAttachable(authorId, mediaId, 'POST', undefined, tx)));
    const kinds = new Set(assets.map((a) => a.kind));
    if (kinds.size > 1) throw new HttpError(400, 'MEDIA_INVALID', "Don't mix images, audio and video in one post");
    const kind = assets[0]?.kind;
    if ((kind === 'AUDIO' || kind === 'VIDEO') && assets.length > 1) {
      throw new HttpError(400, 'MEDIA_INVALID', 'Attach one audio or video file per post');
    }
    const post = await tx.post.create({
      data: {
        authorId,
        type: kind ?? 'TEXT',
        body: input.body || null,
        media: { create: assets.map((a, position) => ({ assetId: a.id, position })) },
      },
    });
    return post.id;
  });
  return getPost(id, authorId);
}

export async function getPost(postId: string, viewer: string | null): Promise<PostView> {
  const post = await prisma.post.findFirst({ where: { id: postId, ...visiblePost }, include: postInclude(viewer) });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  return toPostView(post, viewer);
}

export async function updatePost(authorId: string, postId: string, body: string): Promise<PostView> {
  const post = await prisma.post.findFirst({ where: { id: postId, authorId }, include: { _count: { select: { media: true } } } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  if (!body && post._count.media === 0 && post.type !== 'SHOWCASE') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A text post needs some text');
  }
  await prisma.post.update({ where: { id: postId }, data: { body: body || null, editedAt: new Date() } });
  return getPost(postId, authorId);
}

export async function deletePost(authorId: string, postId: string): Promise<void> {
  const post = await prisma.post.findFirst({ where: { id: postId, authorId }, include: { media: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  await prisma.post.delete({ where: { id: postId } });
  await releaseAssets(post.media.map((m) => m.assetId));
}

/**
 * The main feed. Ranking is deliberately simple and explainable (CLAUDE.md §8.4):
 *  - discover: every visible post, newest first — useful even with few users;
 *  - following: posts by people you follow, plus your own, newest first.
 */
export async function feed(viewer: string | null, tab: FeedTab, page: PageQuery): Promise<Page<PostView>> {
  let where: Prisma.PostWhereInput = visiblePost;
  if (tab === 'following') {
    if (!viewer) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to see posts from people you follow');
    where = { ...visiblePost, author: { ...visibleUser, OR: [{ id: viewer }, { followers: { some: { followerId: viewer } } }] } };
  }
  const result = await paginate(page, (args) =>
    prisma.post.findMany({ where, include: postInclude(viewer), orderBy: newestFirst, ...args }),
  );
  return mapPage(result, (p) => toPostView(p, viewer));
}

export async function profilePosts(username: string, viewer: string | null, page: PageQuery): Promise<Page<PostView>> {
  const authorId = await requireActiveUser(username);
  const result = await paginate(page, (args) =>
    prisma.post.findMany({ where: { ...visiblePost, authorId }, include: postInclude(viewer), orderBy: newestFirst, ...args }),
  );
  return mapPage(result, (p) => toPostView(p, viewer));
}

// ── Likes ────────────────────────────────────────────────────

export async function setLike(userId: string, postId: string, liked: boolean) {
  await requireVisiblePost(postId);
  if (liked) await prisma.postLike.createMany({ data: [{ postId, userId }], skipDuplicates: true });
  else await prisma.postLike.deleteMany({ where: { postId, userId } });
  return { liked, likeCount: await prisma.postLike.count({ where: { postId } }) };
}

// ── Comments ─────────────────────────────────────────────────

const commentInclude = { author: { select: personSelect }, post: { select: { authorId: true } } } satisfies Prisma.CommentInclude;

function toCommentView(c: Prisma.CommentGetPayload<{ include: typeof commentInclude }>, viewer: string | null): CommentView {
  return {
    id: c.id,
    body: c.body,
    author: toPerson(c.author),
    createdAt: c.createdAt.toISOString(),
    // The comment's author and the post's author may remove a comment.
    canDelete: viewer !== null && (viewer === c.authorId || viewer === c.post.authorId),
  };
}

export async function listComments(postId: string, viewer: string | null, page: PageQuery): Promise<Page<CommentView>> {
  await requireVisiblePost(postId);
  const result = await paginate(page, (args) =>
    prisma.comment.findMany({
      where: { postId, removedAt: null, author: visibleUser },
      include: commentInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...args,
    }),
  );
  return mapPage(result, (c) => toCommentView(c, viewer));
}

export async function addComment(authorId: string, postId: string, body: string): Promise<CommentView> {
  await requireVisiblePost(postId);
  const comment = await prisma.comment.create({ data: { postId, authorId, body }, include: commentInclude });
  return toCommentView(comment, authorId);
}

export async function deleteComment(viewer: string, commentId: string): Promise<void> {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, OR: [{ authorId: viewer }, { post: { authorId: viewer } }] },
  });
  if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  await prisma.comment.delete({ where: { id: commentId } });
}

/** Visible posts by id, in the given order (used by the labelled promoted slot). */
export async function visiblePostsByIds(ids: string[], viewer: string | null): Promise<PostView[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.post.findMany({ where: { id: { in: ids }, ...visiblePost }, include: postInclude(viewer) });
  const byId = new Map(rows.map((r) => [r.id, toPostView(r, viewer)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
