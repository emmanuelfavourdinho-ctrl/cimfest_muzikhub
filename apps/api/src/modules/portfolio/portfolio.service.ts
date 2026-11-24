import {
  createPortfolioSchema,
  detectLinkPlatform,
  PORTFOLIO_TYPES,
  publishProblem,
  updatePortfolioSchema,
  type Page,
  type PageQuery,
  type PortfolioItemView,
  type PortfolioStatus,
  type PortfolioType,
} from '@muzikhub/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { mapPage, paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { releaseAssets, requireAttachable, toMediaView } from '../media/media.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { isVisibleStatus, visibleUser } from '../../lib/account-status.js';

type CreateInput = z.output<typeof createPortfolioSchema>;
type UpdateInput = z.output<typeof updatePortfolioSchema>;

export const portfolioInclude = {
  mediaAsset: true,
  coverAsset: true,
  owner: { select: { ...personSelect, status: true } },
} satisfies Prisma.PortfolioItemInclude;

type ItemRow = Prisma.PortfolioItemGetPayload<{ include: typeof portfolioInclude }>;

/** Who may see an item: anyone if published + public (and the owner is active); otherwise only the owner. */
export const publiclyVisible = {
  status: 'PUBLISHED',
  visibility: 'PUBLIC',
  removedAt: null,
  owner: visibleUser,
} satisfies Prisma.PortfolioItemWhereInput;

export function toPortfolioView(item: ItemRow, viewer: string | null): PortfolioItemView {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    genres: item.genres as PortfolioItemView['genres'],
    credits: item.credits,
    externalUrl: item.externalUrl,
    externalPlatform: item.externalPlatform,
    media: item.mediaAsset ? toMediaView(item.mediaAsset) : null,
    cover: item.coverAsset ? toMediaView(item.coverAsset) : null,
    status: item.status,
    visibility: item.visibility,
    featured: item.featured,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    owner: toPerson(item.owner),
    isOwner: viewer === item.ownerId,
    moderation: viewer === item.ownerId && item.removedAt ? { removedAt: item.removedAt.toISOString(), reason: item.removalReason } : null,
  };
}

/** Loads an item the user owns. Others' items are reported as missing (no id probing). */
async function requireOwnItem(ownerId: string, id: string, db: Prisma.TransactionClient = prisma) {
  const item = await db.portfolioItem.findFirst({ where: { id, ownerId } });
  if (!item) throw new HttpError(404, 'PORTFOLIO_NOT_FOUND', 'Portfolio item not found');
  return item;
}

/** The media and cover must be the uploader's own READY assets of a kind this type accepts. */
async function checkAttachments(
  ownerId: string,
  type: PortfolioType,
  mediaId: string | null,
  coverId: string | null,
  db: Prisma.TransactionClient,
) {
  if (mediaId) {
    const kinds = PORTFOLIO_TYPES[type].media;
    if (kinds.length === 0) throw new HttpError(400, 'MEDIA_INVALID', 'Projects take a cover image and links, not a media file');
    await requireAttachable(ownerId, mediaId, 'PORTFOLIO', kinds, db);
  }
  if (coverId) await requireAttachable(ownerId, coverId, 'PORTFOLIO', ['IMAGE'], db);
  if (mediaId && mediaId === coverId) throw new HttpError(400, 'MEDIA_INVALID', 'Use different files for the media and the cover');
}

function assertPublishable(item: {
  type: PortfolioType;
  mediaAssetId: string | null;
  externalUrl: string | null;
  description: string | null;
}) {
  const problem = publishProblem({
    type: item.type,
    hasMedia: Boolean(item.mediaAssetId),
    externalUrl: item.externalUrl,
    description: item.description,
  });
  if (problem) throw new HttpError(400, 'NOT_PUBLISHABLE', problem);
}

/** Creates the feed post for a portfolio item once (never duplicates). Public items only. */
async function shareToFeed(db: Prisma.TransactionClient, item: { id: string; ownerId: string; visibility: string }) {
  if (item.visibility !== 'PUBLIC') {
    throw new HttpError(400, 'NOT_SHAREABLE', 'Only public work can be shared to the feed');
  }
  const existing = await db.post.findFirst({ where: { portfolioItemId: item.id, type: 'SHOWCASE' } });
  if (!existing) await db.post.create({ data: { authorId: item.ownerId, type: 'SHOWCASE', portfolioItemId: item.id } });
}

async function load(id: string, viewer: string | null) {
  return toPortfolioView(await prisma.portfolioItem.findUniqueOrThrow({ where: { id }, include: portfolioInclude }), viewer);
}

export async function createItem(ownerId: string, input: CreateInput): Promise<PortfolioItemView> {
  const id = await prisma.$transaction(async (tx) => {
    await checkAttachments(ownerId, input.type, input.mediaId, input.coverId, tx);
    const data = {
      ownerId,
      type: input.type,
      title: input.title,
      description: input.description,
      genres: input.genres,
      credits: input.credits,
      externalUrl: input.externalUrl,
      externalPlatform: input.externalUrl ? detectLinkPlatform(input.externalUrl) : null,
      mediaAssetId: input.mediaId,
      coverAssetId: input.coverId,
      visibility: input.visibility,
      featured: input.featured,
    };
    if (input.publish) assertPublishable({ ...data, mediaAssetId: input.mediaId });
    const item = await tx.portfolioItem.create({
      data: { ...data, ...(input.publish && { status: 'PUBLISHED', publishedAt: new Date() }) },
    });
    if (input.publish && input.shareToFeed) await shareToFeed(tx, item);
    return item.id;
  });
  return load(id, ownerId);
}

export async function updateItem(ownerId: string, id: string, input: UpdateInput): Promise<PortfolioItemView> {
  const replaced: string[] = [];
  await prisma.$transaction(async (tx) => {
    const current = await requireOwnItem(ownerId, id, tx);
    const next = {
      type: input.type ?? current.type,
      mediaAssetId: input.mediaId !== undefined ? input.mediaId : current.mediaAssetId,
      coverAssetId: input.coverId !== undefined ? input.coverId : current.coverAssetId,
      externalUrl: input.externalUrl !== undefined ? input.externalUrl : current.externalUrl,
      description: input.description !== undefined ? input.description : current.description,
    };
    // Re-validate attachments whenever the type or a file changes (e.g. switching to IMAGE with an audio file attached).
    await checkAttachments(
      ownerId,
      next.type,
      next.mediaAssetId !== current.mediaAssetId || next.type !== current.type ? next.mediaAssetId : null,
      next.coverAssetId !== current.coverAssetId ? next.coverAssetId : null,
      tx,
    );
    if (current.status === 'PUBLISHED') assertPublishable(next);
    if (input.visibility === 'PRIVATE') {
      // Private work must not stay in the public feed.
      await tx.post.deleteMany({ where: { portfolioItemId: id, type: 'SHOWCASE' } });
    }

    await tx.portfolioItem.update({
      where: { id },
      data: {
        type: input.type,
        title: input.title,
        description: input.description,
        genres: input.genres,
        credits: input.credits,
        externalUrl: input.externalUrl,
        ...(input.externalUrl !== undefined && {
          externalPlatform: input.externalUrl ? detectLinkPlatform(input.externalUrl) : null,
        }),
        mediaAssetId: input.mediaId,
        coverAssetId: input.coverId,
        visibility: input.visibility,
        featured: input.featured,
      },
    });
    if (current.mediaAssetId && current.mediaAssetId !== next.mediaAssetId) replaced.push(current.mediaAssetId);
    if (current.coverAssetId && current.coverAssetId !== next.coverAssetId) replaced.push(current.coverAssetId);
  });
  await releaseAssets(replaced); // only after the new state is committed
  return load(id, ownerId);
}

export async function publishItem(ownerId: string, id: string, share: boolean): Promise<PortfolioItemView> {
  await prisma.$transaction(async (tx) => {
    const item = await requireOwnItem(ownerId, id, tx);
    assertPublishable(item);
    await tx.portfolioItem.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: item.publishedAt ?? new Date() },
    });
    if (share) await shareToFeed(tx, item);
  });
  return load(id, ownerId);
}

export async function archiveItem(ownerId: string, id: string): Promise<PortfolioItemView> {
  const item = await requireOwnItem(ownerId, id);
  if (item.status !== 'PUBLISHED') throw new HttpError(409, 'NOT_PUBLISHED', 'Only published work can be archived');
  await prisma.portfolioItem.update({ where: { id }, data: { status: 'ARCHIVED', featured: false } });
  return load(id, ownerId);
}

export async function deleteItem(ownerId: string, id: string): Promise<void> {
  const item = await requireOwnItem(ownerId, id);
  await prisma.portfolioItem.delete({ where: { id } }); // showcase posts cascade
  await releaseAssets([item.mediaAssetId, item.coverAssetId].filter((x): x is string => Boolean(x)));
}

export async function getItem(id: string, viewer: string | null): Promise<PortfolioItemView> {
  const item = await prisma.portfolioItem.findFirst({
    where: { id, OR: [publiclyVisible, ...(viewer ? [{ ownerId: viewer }] : [])] },
    include: portfolioInclude,
  });
  if (!item) throw new HttpError(404, 'PORTFOLIO_NOT_FOUND', 'Portfolio item not found');
  return toPortfolioView(item, viewer);
}

const portfolioOrder = [
  { featured: 'desc' },
  { publishedAt: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.PortfolioItemOrderByWithRelationInput[];

/** A profile's public portfolio (featured first). The owner sees their private published items too. */
export async function listProfilePortfolio(username: string, viewer: string | null, page: PageQuery): Promise<Page<PortfolioItemView>> {
  const owner = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true, status: true } });
  if (!owner || !isVisibleStatus(owner.status)) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'No profile with that username');
  const where: Prisma.PortfolioItemWhereInput =
    viewer === owner.id ? { ownerId: owner.id, status: 'PUBLISHED', removedAt: null } : { ownerId: owner.id, ...publiclyVisible };
  const result = await paginate(page, (args) =>
    prisma.portfolioItem.findMany({ where, include: portfolioInclude, orderBy: portfolioOrder, ...args }),
  );
  return mapPage(result, (item) => toPortfolioView(item, viewer));
}

/** The owner's studio view, filterable by status (drafts, published, archived). */
export async function listOwnPortfolio(
  ownerId: string,
  status: PortfolioStatus | undefined,
  page: PageQuery,
): Promise<Page<PortfolioItemView>> {
  const result = await paginate(page, (args) =>
    prisma.portfolioItem.findMany({
      where: { ownerId, ...(status && { status }) },
      include: portfolioInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...args,
    }),
  );
  return mapPage(result, (item) => toPortfolioView(item, ownerId));
}
