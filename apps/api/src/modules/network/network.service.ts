import {
  CONNECTION_COOLDOWN_DAYS,
  type ConnectionView,
  type Page,
  type PageQuery,
  type PersonSummary,
  type Relationship,
} from '@muzikhub/shared';
import type { Connection, Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { mapPage, paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { isVisibleStatus, visibleUser } from '../../lib/account-status.js';

const DAY = 24 * 60 * 60 * 1000;
const LIVE = ['PENDING', 'ACCEPTED'] as const;

/** Resolves a username to a visible user, or 404 (suspended/banned users are indistinguishable from missing). */
export async function requireActiveUser(username: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true, status: true } });
  if (!user || !isVisibleStatus(user.status)) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'No profile with that username');
  return user.id;
}

const between = (a: string, b: string): Prisma.ConnectionWhereInput => ({
  OR: [
    { requesterId: a, addresseeId: b },
    { requesterId: b, addresseeId: a },
  ],
});

// ── Following (one-way, no approval) ─────────────────────────

export async function follow(followerId: string, username: string) {
  const followingId = await requireActiveUser(username);
  if (followingId === followerId) throw new HttpError(400, 'CANNOT_FOLLOW_SELF', "You can't follow yourself");
  // Idempotent: following twice is a no-op, never a duplicate row.
  await prisma.follow.createMany({ data: [{ followerId, followingId }], skipDuplicates: true });
  return { following: true, followers: await prisma.follow.count({ where: { followingId } }) };
}

export async function unfollow(followerId: string, username: string) {
  const followingId = await requireActiveUser(username);
  await prisma.follow.deleteMany({ where: { followerId, followingId } });
  return { following: false, followers: await prisma.follow.count({ where: { followingId } }) };
}

export async function listFollows(username: string, which: 'followers' | 'following', page: PageQuery): Promise<Page<PersonSummary>> {
  const userId = await requireActiveUser(username);
  // Paginate over Follow rows (composite key), exposing the other person's id as the cursor.
  const where: Prisma.FollowWhereInput =
    which === 'followers' ? { followingId: userId, follower: visibleUser } : { followerId: userId, following: visibleUser };
  const rows = await prisma.follow.findMany({
    where: { ...where, ...(page.cursor && (which === 'followers' ? { followerId: { lt: page.cursor } } : { followingId: { lt: page.cursor } })) },
    orderBy: which === 'followers' ? { followerId: 'desc' } : { followingId: 'desc' },
    take: page.limit + 1,
    include: { follower: { select: { id: true, ...personSelect } }, following: { select: { id: true, ...personSelect } } },
  });
  const people = rows.map((r) => (which === 'followers' ? r.follower : r.following));
  const hasMore = people.length > page.limit;
  const items = people.slice(0, page.limit);
  return { items: items.map(toPerson), nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

// ── Connections (mutual, needs acceptance) ───────────────────

/** When `requesterId` may request `addresseeId` again after a decline (approved 30-day cooldown). */
async function cooldownUntil(requesterId: string, addresseeId: string): Promise<Date | null> {
  const declined = await prisma.connection.findFirst({
    where: { requesterId, addresseeId, status: 'DECLINED' },
    orderBy: { respondedAt: 'desc' },
    select: { respondedAt: true },
  });
  if (!declined?.respondedAt) return null;
  const until = new Date(declined.respondedAt.getTime() + CONNECTION_COOLDOWN_DAYS * DAY);
  return until > new Date() ? until : null;
}

export async function requestConnection(requesterId: string, username: string, message?: string) {
  const addresseeId = await requireActiveUser(username);
  if (addresseeId === requesterId) throw new HttpError(400, 'CANNOT_CONNECT_SELF', "You can't connect with yourself");

  const live = await prisma.connection.findFirst({ where: { ...between(requesterId, addresseeId), status: { in: [...LIVE] } } });
  if (live?.status === 'ACCEPTED') throw new HttpError(409, 'ALREADY_CONNECTED', "You're already connected");
  if (live?.requesterId === requesterId) throw new HttpError(409, 'REQUEST_PENDING', 'Your request is already pending');
  if (live) throw new HttpError(409, 'REQUEST_RECEIVED', 'They already sent you a request — accept it instead');

  const until = await cooldownUntil(requesterId, addresseeId);
  if (until) {
    throw new HttpError(429, 'CONNECTION_COOLDOWN', `You can send another request after ${until.toISOString().slice(0, 10)}`);
  }

  // If two requests race, the partial unique index rejects the second (→ 409 via the error handler).
  const created = await prisma.connection.create({
    data: { requesterId, addresseeId, message: message || null },
    include: connectionInclude,
  });
  return toConnectionView(created, requesterId);
}

/**
 * Applies a state transition only if the row is still in the expected state and the
 * actor has the right role. updateMany + count makes concurrent clicks safe.
 */
async function transition(
  actorId: string,
  connectionId: string,
  rule: { from: 'PENDING' | 'ACCEPTED'; to: 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'REMOVED'; actor: 'addressee' | 'requester' | 'either' },
) {
  const actorFilter: Prisma.ConnectionWhereInput =
    rule.actor === 'addressee' ? { addresseeId: actorId } : rule.actor === 'requester' ? { requesterId: actorId } : { OR: [{ addresseeId: actorId }, { requesterId: actorId }] };
  const result = await prisma.connection.updateMany({
    where: { id: connectionId, status: rule.from, ...actorFilter },
    data: { status: rule.to, ...(rule.to !== 'CANCELLED' && { respondedAt: new Date() }) },
  });
  if (result.count === 0) {
    const exists = await prisma.connection.findFirst({ where: { id: connectionId, OR: [{ addresseeId: actorId }, { requesterId: actorId }] } });
    if (!exists) throw new HttpError(404, 'CONNECTION_NOT_FOUND', 'Connection request not found');
    throw new HttpError(409, 'INVALID_TRANSITION', 'This request has already been answered or withdrawn');
  }
  const updated = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId }, include: connectionInclude });
  return toConnectionView(updated, actorId);
}

export const acceptConnection = (actor: string, id: string) => transition(actor, id, { from: 'PENDING', to: 'ACCEPTED', actor: 'addressee' });
export const declineConnection = (actor: string, id: string) => transition(actor, id, { from: 'PENDING', to: 'DECLINED', actor: 'addressee' });
export const cancelConnection = (actor: string, id: string) => transition(actor, id, { from: 'PENDING', to: 'CANCELLED', actor: 'requester' });
export const removeConnection = (actor: string, id: string) => transition(actor, id, { from: 'ACCEPTED', to: 'REMOVED', actor: 'either' });

const connectionInclude = {
  requester: { select: personSelect },
  addressee: { select: personSelect },
} satisfies Prisma.ConnectionInclude;

function toConnectionView(c: Connection & Prisma.ConnectionGetPayload<{ include: typeof connectionInclude }>, viewerId: string): ConnectionView {
  const outgoing = c.requesterId === viewerId;
  return {
    id: c.id,
    status: c.status,
    direction: outgoing ? 'outgoing' : 'incoming',
    person: toPerson(outgoing ? c.addressee : c.requester),
    message: c.message,
    createdAt: c.createdAt.toISOString(),
    respondedAt: c.respondedAt?.toISOString() ?? null,
  };
}

export async function listConnections(viewerId: string, filter: 'incoming' | 'outgoing' | 'accepted', page: PageQuery): Promise<Page<ConnectionView>> {
  const where: Prisma.ConnectionWhereInput =
    filter === 'incoming'
      ? { addresseeId: viewerId, status: 'PENDING', requester: visibleUser }
      : filter === 'outgoing'
        ? { requesterId: viewerId, status: 'PENDING', addressee: visibleUser }
        : {
            status: 'ACCEPTED',
            OR: [
              { requesterId: viewerId, addressee: visibleUser },
              { addresseeId: viewerId, requester: visibleUser },
            ],
          };
  const result = await paginate(page, (args) =>
    prisma.connection.findMany({ where, include: connectionInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...args }),
  );
  return mapPage(result, (c) => toConnectionView(c, viewerId));
}

export async function relationship(viewerId: string | null, username: string): Promise<Relationship> {
  const targetId = await requireActiveUser(username);
  if (!viewerId || viewerId === targetId) {
    return { isSelf: viewerId === targetId, following: false, followsYou: false, connection: null, canRequestAfter: null };
  }
  const [following, followsYou, live, until] = await Promise.all([
    prisma.follow.count({ where: { followerId: viewerId, followingId: targetId } }),
    prisma.follow.count({ where: { followerId: targetId, followingId: viewerId } }),
    prisma.connection.findFirst({ where: { ...between(viewerId, targetId), status: { in: [...LIVE] } } }),
    cooldownUntil(viewerId, targetId),
  ]);
  return {
    isSelf: false,
    following: following > 0,
    followsYou: followsYou > 0,
    connection: live
      ? { id: live.id, status: live.status as 'PENDING' | 'ACCEPTED', direction: live.requesterId === viewerId ? 'outgoing' : 'incoming' }
      : null,
    canRequestAfter: until?.toISOString() ?? null,
  };
}

/** Counts shown on a profile — always derived from rows, never stored. */
export async function profileStats(userId: string) {
  const [followers, following, connections, publishedWork] = await Promise.all([
    prisma.follow.count({ where: { followingId: userId, follower: visibleUser } }),
    prisma.follow.count({ where: { followerId: userId, following: visibleUser } }),
    prisma.connection.count({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: userId, addressee: visibleUser },
          { addresseeId: userId, requester: visibleUser },
        ],
      },
    }),
    prisma.portfolioItem.count({ where: { ownerId: userId, status: 'PUBLISHED', visibility: 'PUBLIC', removedAt: null } }),
  ]);
  return { followers, following, connections, publishedWork };
}
