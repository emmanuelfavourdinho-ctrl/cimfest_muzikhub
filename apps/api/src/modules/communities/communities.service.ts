import { randomBytes } from 'node:crypto';
import {
  MAX_OWNED_COMMUNITIES,
  type CommunityCard,
  type CommunityDetail,
  type CommunityRole,
  type CreateCommunityInput,
  type MemberView,
  type Page,
} from '@muzikhub/shared';
import type { z } from 'zod';
import type { communityQuerySchema, updateCommunitySchema } from '@muzikhub/shared';
import type { Community, CommunityMember, MediaAsset, Prisma } from '../../generated/prisma/client.js';
import { visibleUser } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { releaseAssets, requireAttachable, toMediaView } from '../media/media.service.js';
import { notify } from '../notifications/notifications.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { assertNotBlocked, blockedIds } from '../safety/blocks.service.js';
import { canAssign, canEditSettings, canManageMembers, canRead, outranks, permissionsFor, type Membership } from './permissions.js';

type Tx = Prisma.TransactionClient;

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length >= 3 ? base : `community-${base}`.replace(/-+$/, '');
}

/** A community that exists and isn't removed, or 404. */
export async function requireCommunity(slug: string, db: Tx | typeof prisma = prisma) {
  const c = await db.community.findFirst({ where: { slug: slug.toLowerCase(), removedAt: null }, include: { coverAsset: true } });
  if (!c) throw new HttpError(404, 'COMMUNITY_NOT_FOUND', 'Community not found');
  return c;
}

export async function membershipOf(communityId: string, userId: string | null, db: Tx | typeof prisma = prisma): Promise<Membership> {
  if (!userId) return null;
  const m = await db.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { role: true, status: true },
  });
  return m;
}

/** Throws unless the viewer may read this community's discussions. */
export async function assertCanRead(c: Pick<Community, 'id' | 'policy'>, userId: string | null) {
  const m = await membershipOf(c.id, userId);
  if (!canRead(c.policy, m)) throw new HttpError(403, 'MEMBERS_ONLY', 'Join this community to read its discussions.');
  return m;
}

const cover = (a: MediaAsset | null) => (a ? (toMediaView(a).urls.wide ?? toMediaView(a).urls.medium ?? null) : null);

async function cards(rows: (Community & { coverAsset: MediaAsset | null })[], viewerId: string | null): Promise<CommunityCard[]> {
  const ids = rows.map((r) => r.id);
  const [members, discussions, mine] = await Promise.all([
    prisma.communityMember.groupBy({ by: ['communityId'], where: { communityId: { in: ids }, status: 'ACTIVE' }, _count: true }),
    prisma.discussion.groupBy({
      by: ['communityId'],
      where: { communityId: { in: ids }, removedAt: null },
      _count: true,
      _max: { lastActivityAt: true },
    }),
    viewerId ? prisma.communityMember.findMany({ where: { communityId: { in: ids }, userId: viewerId } }) : Promise.resolve([]),
  ]);
  const mc = new Map(members.map((m) => [m.communityId, m._count]));
  const dc = new Map(discussions.map((d) => [d.communityId, d]));
  const my = new Map(mine.map((m) => [m.communityId, m]));
  return rows.map((r) => {
    const m = my.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      policy: r.policy,
      interests: r.interests,
      cover: cover(r.coverAsset),
      memberCount: mc.get(r.id) ?? 0,
      discussionCount: dc.get(r.id)?._count ?? 0,
      lastActivityAt: dc.get(r.id)?._max.lastActivityAt?.toISOString() ?? null,
      featured: Boolean(r.featuredAt),
      membership: m ? { status: m.status, role: m.role } : null,
    };
  });
}

/** Discovery: real communities only, newest activity first; featured ones are set by staff. */
export async function listCommunities(viewerId: string | null, q: z.output<typeof communityQuerySchema>): Promise<Page<CommunityCard>> {
  const where: Prisma.CommunityWhereInput = {
    removedAt: null,
    ...(q.category && { category: q.category }),
    ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }),
  };
  const page = await paginate(q, (args) =>
    prisma.community.findMany({ where, include: { coverAsset: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...args }),
  );
  return { items: await cards(page.items, viewerId), nextCursor: page.nextCursor };
}

export async function featuredCommunities(viewerId: string | null) {
  const rows = await prisma.community.findMany({
    where: { removedAt: null, featuredAt: { not: null } },
    include: { coverAsset: true },
    orderBy: { featuredAt: 'desc' },
    take: 6,
  });
  return cards(rows, viewerId);
}

export async function myCommunities(userId: string) {
  const rows = await prisma.community.findMany({
    where: { removedAt: null, members: { some: { userId, status: { in: ['ACTIVE', 'PENDING', 'INVITED'] } } } },
    include: { coverAsset: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return cards(rows, userId);
}

export async function communityDetail(slug: string, viewerId: string | null): Promise<CommunityDetail> {
  const c = await requireCommunity(slug);
  const [card] = await cards([c], viewerId);
  const m = await membershipOf(c.id, viewerId);
  const staff = await prisma.communityMember.findMany({
    where: { communityId: c.id, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN', 'MODERATOR'] }, user: visibleUser },
    include: { user: { select: personSelect } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  const owner = staff.find((s) => s.role === 'OWNER');
  const perms = permissionsFor(m);
  const pendingRequests = perms.manageMembers ? await prisma.communityMember.count({ where: { communityId: c.id, status: 'PENDING' } }) : 0;
  return {
    ...card!,
    rules: c.rules,
    createdAt: c.createdAt.toISOString(),
    canRead: canRead(c.policy, m),
    owner: owner ? toPerson(owner.user) : { username: '', name: 'Former member', image: null },
    moderators: staff.map((s) => ({ ...toPerson(s.user), role: s.role as 'OWNER' | 'ADMIN' | 'MODERATOR' })),
    permissions: perms,
    pendingRequests,
  };
}

async function uniqueSlug(tx: Tx, name: string) {
  const base = slugify(name);
  if (!(await tx.community.findUnique({ where: { slug: base }, select: { id: true } }))) return base;
  return `${base.slice(0, 50)}-${randomBytes(3).toString('hex')}`;
}

export async function createCommunity(userId: string, input: CreateCommunityInput) {
  const owned = await prisma.communityMember.count({ where: { userId, role: 'OWNER', community: { removedAt: null } } });
  if (owned >= MAX_OWNED_COMMUNITIES) {
    throw new HttpError(409, 'TOO_MANY_COMMUNITIES', `You can own up to ${MAX_OWNED_COMMUNITIES} communities.`);
  }
  const slug = await prisma.$transaction(async (tx) => {
    if (input.coverId) await requireAttachable(userId, input.coverId, 'COMMUNITY', ['IMAGE'], tx);
    const slug = await uniqueSlug(tx, input.name);
    const c = await tx.community.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        category: input.category,
        rules: input.rules,
        policy: input.policy,
        interests: input.interests ?? [],
        coverAssetId: input.coverId ?? null,
        createdById: userId,
      },
    });
    await tx.communityMember.create({ data: { communityId: c.id, userId, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
    return slug;
  });
  return communityDetail(slug, userId);
}

export async function updateCommunity(userId: string, slug: string, input: z.output<typeof updateCommunitySchema>) {
  const c = await requireCommunity(slug);
  const m = await membershipOf(c.id, userId);
  if (!canEditSettings(m)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the community owner or admins can change settings.');
  const oldCover = c.coverAssetId;
  await prisma.$transaction(async (tx) => {
    if (input.coverId) await requireAttachable(userId, input.coverId, 'COMMUNITY', ['IMAGE'], tx);
    await tx.community.update({
      where: { id: c.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.rules !== undefined && { rules: input.rules }),
        ...(input.policy !== undefined && { policy: input.policy }),
        ...(input.interests !== undefined && { interests: input.interests }),
        ...(input.coverId !== undefined && { coverAssetId: input.coverId }),
      },
    });
  });
  if (input.coverId !== undefined && oldCover && oldCover !== input.coverId) await releaseAssets([oldCover]);
  return communityDetail(c.slug, userId);
}

/** The owner closes the community (soft: hidden everywhere; platform staff can still see it). */
export async function archiveCommunity(userId: string, slug: string) {
  const c = await requireCommunity(slug);
  const m = await membershipOf(c.id, userId);
  if (m?.role !== 'OWNER' || m.status !== 'ACTIVE') throw new HttpError(403, 'NOT_ALLOWED', 'Only the owner can close this community.');
  await prisma.community.update({
    where: { id: c.id },
    data: { removedAt: new Date(), removedById: userId, removalReason: 'Closed by its owner' },
  });
  return { closed: true };
}

// ── Membership ───────────────────────────────────────────────

async function staffIds(communityId: string) {
  const rows = await prisma.communityMember.findMany({
    where: { communityId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN', 'MODERATOR'] } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function joinCommunity(userId: string, slug: string, note?: string) {
  const c = await requireCommunity(slug);
  const existing = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: c.id, userId } } });
  if (existing?.status === 'BANNED') throw new HttpError(403, 'BANNED', 'You can’t join this community.');
  if (existing?.status === 'ACTIVE') return communityDetail(c.slug, userId);
  if (existing?.status === 'PENDING') throw new HttpError(409, 'REQUEST_PENDING', 'Your request to join is waiting for a moderator.');
  if (existing?.status === 'INVITED') return acceptInvitation(userId, slug);
  if (c.policy === 'INVITE') throw new HttpError(403, 'INVITE_ONLY', 'This community is invitation only.');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  if (c.policy === 'OPEN') {
    await prisma.communityMember.create({ data: { communityId: c.id, userId, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() } });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.communityMember.create({
        data: { communityId: c.id, userId, role: 'MEMBER', status: 'PENDING', requestNote: note || null },
      });
      for (const id of await staffIds(c.id)) {
        await notify(tx, id, {
          type: 'community.join_request',
          title: `${me.name} asked to join ${c.name}`,
          body: note ? `“${note.slice(0, 140)}”` : 'Approve or decline from the members page.',
          link: `/communities/${c.slug}/members?tab=requests`,
          dedupeKey: `community-request:${c.id}:${userId}:${id}`,
        });
      }
    });
  }
  return communityDetail(c.slug, userId);
}

export async function leaveCommunity(userId: string, slug: string) {
  const c = await requireCommunity(slug);
  const m = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: c.id, userId } } });
  if (!m || m.status === 'BANNED') throw new HttpError(404, 'NOT_A_MEMBER', 'You are not a member of this community.');
  if (m.role === 'OWNER')
    throw new HttpError(409, 'OWNER_CANNOT_LEAVE', 'Make another member the owner, or close the community, before you leave.');
  await prisma.communityMember.delete({ where: { communityId_userId: { communityId: c.id, userId } } });
  return communityDetail(c.slug, userId);
}

export async function listMembers(
  viewerId: string | null,
  slug: string,
  status: 'ACTIVE' | 'PENDING' | 'INVITED' | 'BANNED',
  cursor?: string,
) {
  const c = await requireCommunity(slug);
  const m = await membershipOf(c.id, viewerId);
  if (status !== 'ACTIVE' && !canManageMembers(m)) throw new HttpError(403, 'NOT_ALLOWED', 'Only moderators can see this list.');
  if (status === 'ACTIVE' && !canRead(c.policy, m)) throw new HttpError(403, 'MEMBERS_ONLY', 'Join this community to see its members.');
  const hidden = await blockedIds(viewerId);
  const rows = await prisma.communityMember.findMany({
    where: { communityId: c.id, status, user: { ...visibleUser, id: { notIn: hidden } } },
    include: { user: { select: { id: true, ...personSelect } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }, { userId: 'asc' }],
    take: 51,
    ...(cursor && { cursor: { communityId_userId: { communityId: c.id, userId: cursor } }, skip: 1 }),
  });
  const page = rows.slice(0, 50);
  const items: MemberView[] = page.map((r) => ({
    ...toPerson(r.user),
    role: r.role,
    status: r.status,
    requestNote: canManageMembers(m) ? r.requestNote : null,
    joinedAt: r.joinedAt?.toISOString() ?? null,
  }));
  return { items, nextCursor: rows.length > 50 ? page.at(-1)!.userId : null };
}

async function target(c: Community, username: string): Promise<CommunityMember & { user: { name: string } }> {
  const u = await prisma.user.findFirst({ where: { username: username.toLowerCase() }, select: { id: true } });
  const row =
    u &&
    (await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: c.id, userId: u.id } },
      include: { user: { select: { name: true } } },
    }));
  if (!row) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'That person isn’t in this community.');
  return row;
}

const auditCommunity = (
  tx: Tx,
  actorId: string,
  role: CommunityRole,
  action: string,
  c: Community,
  reason: string | null,
  before: object,
  after: object,
) =>
  writeAudit(tx, {
    actor: { id: actorId, role: `community:${role}` },
    action,
    target: { type: 'community', id: c.id },
    reason,
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
  });

export async function decideRequest(actorId: string, slug: string, username: string, approve: boolean) {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  if (!canManageMembers(actor)) throw new HttpError(403, 'NOT_ALLOWED', 'Only moderators can answer join requests.');
  const t = await target(c, username);
  if (t.status !== 'PENDING') throw new HttpError(409, 'NOT_PENDING', 'There’s no pending request from this person.');
  await prisma.$transaction(async (tx) => {
    if (approve)
      await tx.communityMember.update({
        where: { communityId_userId: { communityId: c.id, userId: t.userId } },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
    else await tx.communityMember.delete({ where: { communityId_userId: { communityId: c.id, userId: t.userId } } });
    await notify(tx, t.userId, {
      type: approve ? 'community.request_approved' : 'community.request_declined',
      title: approve ? `You’re in: ${c.name}` : `Your request to join ${c.name} wasn’t approved`,
      body: approve ? 'Say hello and read the rules before you post.' : 'You can look for other communities on Discover.',
      link: approve ? `/communities/${c.slug}` : '/communities',
    });
  });
  return { status: approve ? 'ACTIVE' : 'DECLINED' };
}

export async function invite(actorId: string, slug: string, username: string) {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  if (!canManageMembers(actor)) throw new HttpError(403, 'NOT_ALLOWED', 'Only moderators can invite people.');
  const u = await prisma.user.findFirst({ where: { username: username.toLowerCase(), ...visibleUser }, select: { id: true } });
  if (!u) throw new HttpError(404, 'USER_NOT_FOUND', 'No member with that username.');
  await assertNotBlocked(actorId, u.id);
  const existing = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: c.id, userId: u.id } } });
  if (existing?.status === 'ACTIVE') throw new HttpError(409, 'ALREADY_MEMBER', 'They’re already a member.');
  if (existing?.status === 'BANNED') throw new HttpError(409, 'BANNED', 'Unban them first.');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } });
  await prisma.$transaction(async (tx) => {
    if (existing?.status === 'PENDING') {
      // An invite answers their own request.
      await tx.communityMember.update({
        where: { communityId_userId: { communityId: c.id, userId: u.id } },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
    } else if (!existing) {
      await tx.communityMember.create({
        data: { communityId: c.id, userId: u.id, role: 'MEMBER', status: 'INVITED', invitedById: actorId },
      });
    }
    await notify(tx, u.id, {
      type: 'community.invitation',
      title: `${me.name} invited you to ${c.name}`,
      body: c.description.slice(0, 140),
      link: `/communities/${c.slug}`,
      dedupeKey: `community-invite:${c.id}:${u.id}`,
    });
  });
  return { invited: true };
}

export async function acceptInvitation(userId: string, slug: string) {
  const c = await requireCommunity(slug);
  const { count } = await prisma.communityMember.updateMany({
    where: { communityId: c.id, userId, status: 'INVITED' },
    data: { status: 'ACTIVE', joinedAt: new Date() },
  });
  if (count === 0) throw new HttpError(404, 'NO_INVITATION', 'There’s no invitation waiting for you here.');
  return communityDetail(c.slug, userId);
}

export async function declineInvitation(userId: string, slug: string) {
  const c = await requireCommunity(slug);
  const { count } = await prisma.communityMember.deleteMany({ where: { communityId: c.id, userId, status: 'INVITED' } });
  if (count === 0) throw new HttpError(404, 'NO_INVITATION', 'There’s no invitation waiting for you here.');
  return { declined: true };
}

/** Remove someone from the community and stop them coming back (moderator+, higher role only). */
export async function banMember(actorId: string, slug: string, username: string, reason: string | null) {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  const t = await target(c, username);
  if (!canManageMembers(actor) || !outranks(actor, t.role)) throw new HttpError(403, 'NOT_ALLOWED', 'You can’t remove this member.');
  await prisma.$transaction(async (tx) => {
    await tx.communityMember.update({
      where: { communityId_userId: { communityId: c.id, userId: t.userId } },
      data: { status: 'BANNED', role: 'MEMBER' },
    });
    await auditCommunity(
      tx,
      actorId,
      actor!.role,
      'community.member.ban',
      c,
      reason,
      { userId: t.userId, role: t.role, status: t.status },
      { status: 'BANNED' },
    );
    await notify(tx, t.userId, {
      type: 'community.removed',
      title: `You were removed from ${c.name}`,
      body: reason ? `Reason: ${reason}` : 'A moderator removed you from this community.',
      link: '/communities',
    });
  });
  return { status: 'BANNED' };
}

export async function unbanMember(actorId: string, slug: string, username: string) {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  if (!canManageMembers(actor)) throw new HttpError(403, 'NOT_ALLOWED', 'Only moderators can do that.');
  const t = await target(c, username);
  if (t.status !== 'BANNED') throw new HttpError(409, 'NOT_BANNED', 'This person isn’t banned.');
  await prisma.$transaction(async (tx) => {
    await tx.communityMember.delete({ where: { communityId_userId: { communityId: c.id, userId: t.userId } } });
    await auditCommunity(tx, actorId, actor!.role, 'community.member.unban', c, null, { status: 'BANNED' }, { status: null });
  });
  return { status: null };
}

export async function setRole(actorId: string, slug: string, username: string, role: 'ADMIN' | 'MODERATOR' | 'MEMBER') {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  const t = await target(c, username);
  if (t.status !== 'ACTIVE') throw new HttpError(409, 'NOT_ACTIVE', 'Only active members can be given a role.');
  if (!canAssign(actor, t.role, role)) throw new HttpError(403, 'NOT_ALLOWED', 'You can’t give that role.');
  await prisma.$transaction(async (tx) => {
    await tx.communityMember.update({ where: { communityId_userId: { communityId: c.id, userId: t.userId } }, data: { role } });
    await auditCommunity(tx, actorId, actor!.role, 'community.member.role', c, null, { userId: t.userId, role: t.role }, { role });
    if (role !== 'MEMBER') {
      await notify(tx, t.userId, {
        type: 'community.role',
        title: `You’re now a${role === 'ADMIN' ? 'n admin' : ' moderator'} of ${c.name}`,
        body: 'You can now help manage members and keep discussions on track.',
        link: `/communities/${c.slug}`,
      });
    }
  });
  return { role };
}

/** Hand the community to another active member (owner only); the old owner becomes an admin. */
export async function transferOwnership(actorId: string, slug: string, username: string) {
  const c = await requireCommunity(slug);
  const actor = await membershipOf(c.id, actorId);
  if (actor?.role !== 'OWNER' || actor.status !== 'ACTIVE') throw new HttpError(403, 'NOT_ALLOWED', 'Only the owner can do that.');
  const t = await target(c, username);
  if (t.status !== 'ACTIVE' || t.userId === actorId) throw new HttpError(409, 'NOT_ACTIVE', 'Choose another active member.');
  await prisma.$transaction(async (tx) => {
    await tx.communityMember.update({ where: { communityId_userId: { communityId: c.id, userId: actorId } }, data: { role: 'ADMIN' } });
    await tx.communityMember.update({ where: { communityId_userId: { communityId: c.id, userId: t.userId } }, data: { role: 'OWNER' } });
    await auditCommunity(tx, actorId, 'OWNER', 'community.owner.transfer', c, null, { ownerId: actorId }, { ownerId: t.userId });
    await notify(tx, t.userId, {
      type: 'community.role',
      title: `You’re now the owner of ${c.name}`,
      body: 'You can manage its settings, roles and members.',
      link: `/communities/${c.slug}`,
    });
  });
  return { owner: username };
}
