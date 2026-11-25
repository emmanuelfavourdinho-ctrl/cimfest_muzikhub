import { extractMentions, type DiscussionCommentView, type DiscussionKind, type DiscussionView, type Page } from '@muzikhub/shared';
import type { Community, Prisma } from '../../generated/prisma/client.js';
import { visibleUser } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { notify } from '../notifications/notifications.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { blockedIds } from '../safety/blocks.service.js';
import { assertCanRead, membershipOf, requireCommunity } from './communities.service.js';
import { canAnnounce, canModerate, canPost, canRead, type Membership } from './permissions.js';

type Tx = Prisma.TransactionClient;

const discussionInclude = (viewer: string | null) =>
  ({
    community: { select: { id: true, slug: true, name: true, policy: true } },
    author: { select: { id: true, ...personSelect } },
    _count: { select: { comments: { where: { removedAt: null } }, reactions: true } },
    reactions: { where: { userId: viewer ?? '__nobody__' }, select: { userId: true } },
    follows: { where: { userId: viewer ?? '__nobody__' }, select: { userId: true } },
  }) satisfies Prisma.DiscussionInclude;
type DiscussionRow = Prisma.DiscussionGetPayload<{ include: ReturnType<typeof discussionInclude> }>;

async function rolesIn(communityId: string, userIds: string[]) {
  const rows = await prisma.communityMember.findMany({
    where: { communityId, userId: { in: userIds }, status: 'ACTIVE' },
    select: { userId: true, role: true },
  });
  return new Map(rows.map((r) => [r.userId, r.role]));
}

async function toViews(rows: DiscussionRow[], viewer: string | null, m: Membership): Promise<DiscussionView[]> {
  if (rows.length === 0) return [];
  const roles = await rolesIn(
    rows[0]!.communityId,
    rows.map((r) => r.authorId),
  );
  return rows.map((d) => ({
    id: d.id,
    community: { slug: d.community.slug, name: d.community.name },
    kind: d.kind,
    title: d.title,
    body: d.body,
    author: { ...toPerson(d.author), communityRole: roles.get(d.authorId) ?? null },
    pinned: Boolean(d.pinnedAt),
    locked: Boolean(d.lockedAt),
    answered: Boolean(d.acceptedCommentId),
    acceptedCommentId: d.acceptedCommentId,
    commentCount: d._count.comments,
    helpfulCount: d._count.reactions,
    helpfulByMe: d.reactions.length > 0,
    followedByMe: d.follows.length > 0,
    isAuthor: viewer === d.authorId,
    canModerate: canModerate(m),
    createdAt: d.createdAt.toISOString(),
    editedAt: d.editedAt?.toISOString() ?? null,
    lastActivityAt: d.lastActivityAt.toISOString(),
  }));
}

/** A visible discussion the viewer may read, with its community, or 404/403. */
async function requireDiscussion(id: string, viewer: string | null) {
  const d = await prisma.discussion.findFirst({
    where: { id, removedAt: null, community: { removedAt: null }, author: visibleUser },
    include: { community: true },
  });
  if (!d) throw new HttpError(404, 'DISCUSSION_NOT_FOUND', 'Discussion not found');
  const m = await assertCanRead(d.community, viewer);
  return { d, m };
}

/** Pinned first, then most recent activity. Members-only communities need membership. */
export async function listDiscussions(
  viewer: string | null,
  slug: string,
  q: { kind?: DiscussionKind; cursor?: string; limit: number },
): Promise<Page<DiscussionView>> {
  const c = await requireCommunity(slug);
  const m = await assertCanRead(c, viewer);
  const hidden = await blockedIds(viewer);
  const rows = await prisma.discussion.findMany({
    where: { communityId: c.id, removedAt: null, author: { ...visibleUser, id: { notIn: hidden } }, ...(q.kind && { kind: q.kind }) },
    include: discussionInclude(viewer),
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { lastActivityAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
  });
  const page = rows.slice(0, q.limit);
  return { items: await toViews(page, viewer, m), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

export async function getDiscussion(viewer: string | null, id: string): Promise<DiscussionView> {
  const { m } = await requireDiscussion(id, viewer);
  const row = await prisma.discussion.findUniqueOrThrow({ where: { id }, include: discussionInclude(viewer) });
  return (await toViews([row], viewer, m))[0]!;
}

/** Notify @mentioned people who can read the community (not the author, not blocked). */
async function notifyMentions(tx: Tx, c: Community, actor: { id: string; name: string }, text: string, link: string, excludeIds: string[]) {
  const usernames = extractMentions(text);
  if (usernames.length === 0) return;
  const users = await tx.user.findMany({ where: { username: { in: usernames }, ...visibleUser }, select: { id: true } });
  const hidden = new Set(await blockedIds(actor.id));
  for (const u of users) {
    if (u.id === actor.id || excludeIds.includes(u.id) || hidden.has(u.id)) continue;
    if (!canRead(c.policy, await membershipOf(c.id, u.id, tx))) continue;
    await notify(tx, u.id, {
      type: 'community.mention',
      title: `${actor.name} mentioned you in ${c.name}`,
      body: text.slice(0, 140),
      link,
    });
  }
}

export async function createDiscussion(userId: string, slug: string, input: { kind: DiscussionKind; title: string; body: string }) {
  const c = await requireCommunity(slug);
  const m = await membershipOf(c.id, userId);
  if (!canPost(m)) throw new HttpError(403, 'MEMBERS_ONLY', 'Join this community to start a discussion.');
  if (input.kind === 'ANNOUNCEMENT' && !canAnnounce(m))
    throw new HttpError(403, 'NOT_ALLOWED', 'Only the owner and admins can post announcements.');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } });
  const id = await prisma.$transaction(async (tx) => {
    const d = await tx.discussion.create({
      data: { communityId: c.id, authorId: userId, kind: input.kind, title: input.title, body: input.body },
    });
    await tx.discussionFollow.create({ data: { discussionId: d.id, userId } });
    await tx.community.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    await notifyMentions(tx, c, me, `${input.title}\n${input.body}`, `/communities/${c.slug}/d/${d.id}`, []);
    return d.id;
  });
  return getDiscussion(userId, id);
}

export async function updateDiscussion(userId: string, id: string, input: { title?: string; body?: string }) {
  const { d } = await requireDiscussion(id, userId);
  if (d.authorId !== userId) throw new HttpError(403, 'NOT_AUTHOR', 'Only the author can edit this discussion.');
  await prisma.discussion.update({ where: { id }, data: { ...input, editedAt: new Date() } });
  return getDiscussion(userId, id);
}

export async function deleteDiscussion(userId: string, id: string) {
  const { d } = await requireDiscussion(id, userId);
  if (d.authorId !== userId) throw new HttpError(403, 'NOT_AUTHOR', 'Only the author can delete this discussion.');
  await prisma.discussion.delete({ where: { id } });
  return { deleted: true };
}

async function requireModerator(userId: string, id: string) {
  const { d, m } = await requireDiscussion(id, userId);
  if (!canModerate(m)) throw new HttpError(403, 'NOT_ALLOWED', 'Only this community’s moderators can do that.');
  return { d, m: m! };
}

/** Community moderation: pin, lock or remove (reason, audited, author told). Scoped to this community. */
export async function moderateDiscussion(
  userId: string,
  id: string,
  action: 'pin' | 'unpin' | 'lock' | 'unlock' | 'remove',
  reason?: string,
) {
  const { d, m } = await requireModerator(userId, id);
  const data: Prisma.DiscussionUpdateInput =
    action === 'pin'
      ? { pinnedAt: new Date() }
      : action === 'unpin'
        ? { pinnedAt: null }
        : action === 'lock'
          ? { lockedAt: new Date() }
          : action === 'unlock'
            ? { lockedAt: null }
            : { removedAt: new Date(), removedById: userId, removalReason: reason ?? 'Removed by a community moderator' };
  await prisma.$transaction(async (tx) => {
    await tx.discussion.update({ where: { id }, data });
    if (action === 'remove' || action === 'lock') {
      await writeAudit(tx, {
        actor: { id: userId, role: `community:${m.role}` },
        action: `community.discussion.${action}`,
        target: { type: 'discussion', id },
        reason: reason ?? null,
        before: { title: d.title },
        after: { action },
      });
    }
    if (action === 'remove' && d.authorId !== userId) {
      await notify(tx, d.authorId, {
        type: 'community.content_removed',
        title: `Your discussion in ${d.community.name} was removed`,
        body: `“${d.title}”${reason ? `: ${reason}` : ''}`,
        link: `/communities/${d.community.slug}`,
      });
    }
  });
  return action === 'remove' ? { removed: true } : getDiscussion(userId, id);
}

export async function setHelpful(userId: string, id: string, on: boolean) {
  const { m } = await requireDiscussion(id, userId);
  if (!canPost(m)) throw new HttpError(403, 'MEMBERS_ONLY', 'Join this community to react.');
  if (on) await prisma.discussionReaction.createMany({ data: [{ discussionId: id, userId }], skipDuplicates: true });
  else await prisma.discussionReaction.deleteMany({ where: { discussionId: id, userId } });
  return getDiscussion(userId, id);
}

export async function setFollow(userId: string, id: string, on: boolean) {
  await requireDiscussion(id, userId);
  if (on) await prisma.discussionFollow.createMany({ data: [{ discussionId: id, userId }], skipDuplicates: true });
  else await prisma.discussionFollow.deleteMany({ where: { discussionId: id, userId } });
  return getDiscussion(userId, id);
}

// ── Replies ──────────────────────────────────────────────────

const commentInclude = { author: { select: { id: true, ...personSelect } } } satisfies Prisma.DiscussionCommentInclude;
type CommentRow = Prisma.DiscussionCommentGetPayload<{ include: typeof commentInclude }>;

async function commentViews(
  rows: CommentRow[],
  communityId: string,
  acceptedId: string | null,
  viewer: string | null,
  m: Membership,
): Promise<DiscussionCommentView[]> {
  const roles = await rolesIn(
    communityId,
    rows.map((r) => r.authorId),
  );
  return rows.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    body: c.body,
    author: { ...toPerson(c.author), communityRole: roles.get(c.authorId) ?? null },
    isAuthor: viewer === c.authorId,
    canModerate: canModerate(m),
    accepted: acceptedId === c.id,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
  }));
}

/** Oldest first (a conversation), paginated forward. */
export async function listComments(viewer: string | null, discussionId: string, cursor?: string): Promise<Page<DiscussionCommentView>> {
  const { d, m } = await requireDiscussion(discussionId, viewer);
  const hidden = await blockedIds(viewer);
  const rows = await prisma.discussionComment.findMany({
    where: { discussionId, removedAt: null, author: { ...visibleUser, id: { notIn: hidden } } },
    include: commentInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 51,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const page = rows.slice(0, 50);
  return {
    items: await commentViews(page, d.communityId, d.acceptedCommentId, viewer, m),
    nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
  };
}

export async function addComment(userId: string, discussionId: string, body: string, parentId?: string) {
  const { d, m } = await requireDiscussion(discussionId, userId);
  if (!canPost(m)) throw new HttpError(403, 'MEMBERS_ONLY', 'Join this community to reply.');
  if (d.lockedAt) throw new HttpError(409, 'LOCKED', 'This discussion is locked.');
  if (parentId) {
    const parent = await prisma.discussionComment.findFirst({ where: { id: parentId, discussionId, removedAt: null } });
    if (!parent) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'The reply you answered no longer exists.');
    if (parent.parentId) throw new HttpError(400, 'TOO_DEEP', 'Reply to the original comment instead.');
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } });
  const link = `/communities/${d.community.slug}/d/${d.id}`;
  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.discussionComment.create({
      data: { discussionId, authorId: userId, body, parentId: parentId ?? null },
      include: commentInclude,
    });
    await tx.discussion.update({ where: { id: discussionId }, data: { lastActivityAt: new Date() } });
    await tx.community.update({ where: { id: d.communityId }, data: { updatedAt: new Date() } });
    await tx.discussionFollow.createMany({ data: [{ discussionId, userId }], skipDuplicates: true });
    // Followers (author and earlier repliers) hear about replies: at most once per discussion per day.
    const followers = await tx.discussionFollow.findMany({ where: { discussionId, userId: { not: userId } }, select: { userId: true } });
    const hidden = new Set(await blockedIds(userId));
    const day = new Date().toISOString().slice(0, 10);
    for (const f of followers) {
      if (hidden.has(f.userId)) continue;
      await notify(tx, f.userId, {
        type: 'community.reply',
        title: `${me.name} replied in “${d.title.slice(0, 60)}”`,
        body: body.slice(0, 140),
        link,
        dedupeKey: `community-reply:${discussionId}:${f.userId}:${day}`,
      });
    }
    await notifyMentions(
      tx,
      d.community,
      me,
      body,
      link,
      followers.map((f) => f.userId),
    );
    return c;
  });
  return (await commentViews([created], d.communityId, d.acceptedCommentId, userId, m))[0]!;
}

async function requireComment(id: string, viewer: string) {
  const c = await prisma.discussionComment.findFirst({
    where: { id, removedAt: null },
    include: { discussion: { include: { community: true } } },
  });
  if (!c || c.discussion.removedAt || c.discussion.community.removedAt) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'Reply not found');
  const m = await assertCanRead(c.discussion.community, viewer);
  return { c, m };
}

export async function updateComment(userId: string, id: string, body: string) {
  const { c, m } = await requireComment(id, userId);
  if (c.authorId !== userId) throw new HttpError(403, 'NOT_AUTHOR', 'Only the author can edit this reply.');
  const row = await prisma.discussionComment.update({ where: { id }, data: { body, editedAt: new Date() }, include: commentInclude });
  return (await commentViews([row], c.discussion.communityId, c.discussion.acceptedCommentId, userId, m))[0]!;
}

export async function deleteComment(userId: string, id: string) {
  const { c } = await requireComment(id, userId);
  if (c.authorId !== userId) throw new HttpError(403, 'NOT_AUTHOR', 'Only the author can delete this reply.');
  await prisma.$transaction(async (tx) => {
    if (c.discussion.acceptedCommentId === id)
      await tx.discussion.update({ where: { id: c.discussionId }, data: { acceptedCommentId: null } });
    await tx.discussionComment.delete({ where: { id } });
  });
  return { deleted: true };
}

export async function removeComment(userId: string, id: string, reason?: string) {
  const { c, m } = await requireComment(id, userId);
  if (!canModerate(m)) throw new HttpError(403, 'NOT_ALLOWED', 'Only this community’s moderators can do that.');
  await prisma.$transaction(async (tx) => {
    await tx.discussionComment.update({
      where: { id },
      data: { removedAt: new Date(), removedById: userId, removalReason: reason ?? 'Removed by a community moderator' },
    });
    await writeAudit(tx, {
      actor: { id: userId, role: `community:${m!.role}` },
      action: 'community.comment.remove',
      target: { type: 'discussion_comment', id },
      reason: reason ?? null,
      before: { excerpt: c.body.slice(0, 200) },
      after: { removed: true },
    });
    if (c.authorId !== userId) {
      await notify(tx, c.authorId, {
        type: 'community.content_removed',
        title: `Your reply in ${c.discussion.community.name} was removed`,
        body: reason ?? 'A community moderator removed it.',
        link: `/communities/${c.discussion.community.slug}/d/${c.discussionId}`,
      });
    }
  });
  return { removed: true };
}

/** Q&A: the asker (or a moderator) marks the reply that answered the question. */
export async function acceptAnswer(userId: string, discussionId: string, commentId: string | null) {
  const { d, m } = await requireDiscussion(discussionId, userId);
  if (d.kind !== 'QUESTION') throw new HttpError(409, 'NOT_A_QUESTION', 'Only questions have an accepted answer.');
  if (d.authorId !== userId && !canModerate(m)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the person who asked can choose the answer.');
  if (commentId) {
    const c = await prisma.discussionComment.findFirst({ where: { id: commentId, discussionId, removedAt: null } });
    if (!c) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'Reply not found');
    await prisma.$transaction(async (tx) => {
      await tx.discussion.update({ where: { id: discussionId }, data: { acceptedCommentId: commentId } });
      if (c.authorId !== userId) {
        await notify(tx, c.authorId, {
          type: 'community.answer_accepted',
          title: 'Your reply was marked as the answer',
          body: `“${d.title.slice(0, 100)}” in ${d.community.name}`,
          link: `/communities/${d.community.slug}/d/${d.id}`,
        });
      }
    });
  } else {
    await prisma.discussion.update({ where: { id: discussionId }, data: { acceptedCommentId: null } });
  }
  return getDiscussion(userId, discussionId);
}

/** Recent discussions across the communities the user belongs to (for the communities hub). */
export async function recentForMember(userId: string) {
  const rows = await prisma.discussion.findMany({
    where: { removedAt: null, community: { removedAt: null, members: { some: { userId, status: 'ACTIVE' } } }, author: visibleUser },
    include: discussionInclude(userId),
    orderBy: { lastActivityAt: 'desc' },
    take: 8,
  });
  const views: DiscussionView[] = [];
  for (const r of rows) views.push(...(await toViews([r], userId, await membershipOf(r.communityId, userId))));
  return views;
}
