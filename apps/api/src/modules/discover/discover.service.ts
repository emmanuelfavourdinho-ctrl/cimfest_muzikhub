import {
  discoverPeopleQuerySchema,
  discoverWorkQuerySchema,
  type Page,
  type PersonCard,
  type PortfolioItemView,
} from '@muzikhub/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { mapPage, paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { toMediaView } from '../media/media.service.js';
import { portfolioInclude, publiclyVisible, toPortfolioView } from '../portfolio/portfolio.service.js';
import { toPerson } from '../profiles/people.js';
import { visibleUser } from '../../lib/account-status.js';

type PeopleQuery = z.output<typeof discoverPeopleQuerySchema>;
type WorkQuery = z.output<typeof discoverWorkQuerySchema>;

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

/**
 * Real-data people search (FR-16..19). Text matches name, username, bio, location or an
 * exact skill; filters use the GIN-indexed role/genre arrays. Newest members first.
 */
export async function discoverPeople(viewer: string | null, query: PeopleQuery): Promise<Page<PersonCard>> {
  const profileFilter: Prisma.ProfileWhereInput = {
    ...(query.roles.length > 0 && { roles: { hasSome: query.roles } }),
    ...(query.genres.length > 0 && { genres: { hasSome: query.genres } }),
    ...(query.location && { location: contains(query.location) }),
  };
  const where: Prisma.UserWhereInput = {
    ...visibleUser,
    username: { not: null },
    ...(viewer && { id: { not: viewer } }),
    profile: { is: profileFilter },
    ...(query.q && {
      OR: [
        { name: contains(query.q) },
        { username: contains(query.q) },
        { profile: { is: { OR: [{ bio: contains(query.q) }, { location: contains(query.q) }, { skills: { has: query.q } }] } } },
      ],
    }),
  };

  const result = await paginate(query, (args) =>
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        username: true,
        name: true,
        primaryUse: true,
        profile: { include: { avatarAsset: true, coverAsset: true } },
        _count: { select: { portfolioItems: { where: { status: 'PUBLISHED', visibility: 'PUBLIC', removedAt: null } } } },
      },
      ...args,
    }),
  );

  const followed = viewer
    ? new Set(
        (await prisma.follow.findMany({
          where: { followerId: viewer, followingId: { in: result.items.map((u) => u.id) } },
          select: { followingId: true },
        })).map((f) => f.followingId),
      )
    : new Set<string>();

  return mapPage(result, (u) => ({
    ...toPerson(u),
    primaryUse: u.primaryUse,
    roles: u.profile?.roles ?? [],
    genres: (u.profile?.genres ?? []) as PersonCard['genres'],
    location: u.profile?.location ?? null,
    bio: u.profile?.bio ?? null,
    cover: u.profile?.coverAsset ? toMediaView(u.profile.coverAsset) : null,
    publishedWorkCount: u._count.portfolioItems,
    following: followed.has(u.id),
  }));
}

/** Browse published, public creative work by type, genre and text. Newest first. */
export async function discoverWork(viewer: string | null, query: WorkQuery): Promise<Page<PortfolioItemView>> {
  const where: Prisma.PortfolioItemWhereInput = {
    ...publiclyVisible,
    ...(query.types.length > 0 && { type: { in: query.types } }),
    ...(query.genres.length > 0 && { genres: { hasSome: query.genres } }),
    ...(query.q && { OR: [{ title: contains(query.q) }, { description: contains(query.q) }, { credits: contains(query.q) }] }),
  };
  const result = await paginate(query, (args) =>
    prisma.portfolioItem.findMany({ where, include: portfolioInclude, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], ...args }),
  );
  return mapPage(result, (item) => toPortfolioView(item, viewer));
}
