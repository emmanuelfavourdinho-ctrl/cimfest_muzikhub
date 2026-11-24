import { randomUUID } from 'node:crypto';
import {
  CHUNKED_UPLOAD_THRESHOLD,
  checkUpload,
  MEDIA_RULES,
  PURPOSE_KINDS,
  UPLOAD_CHUNK_BYTES,
  type CreateUploadInput,
  type MediaKind,
  type MediaPurpose,
  type MediaView,
  type SignedUpload,
} from '@muzikhub/shared';
import { env } from '../../config/env.js';
import type { MediaAsset, Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { mediaStorage } from '../../lib/media.js';
import { resourceTypeFor, type RemoteResource } from '../../lib/media-storage.js';
import { prisma } from '../../lib/prisma.js';

/** Unfinished uploads a user may have at once — stops signature farming. */
const MAX_PENDING_PER_USER = 20;

function requireConfigured() {
  if (!mediaStorage().configured) {
    throw new HttpError(503, 'MEDIA_NOT_CONFIGURED', 'Media uploads are not available right now.');
  }
}

export function toMediaView(
  asset: Pick<MediaAsset, 'id' | 'kind' | 'publicId' | 'version' | 'width' | 'height' | 'durationSec'>,
): MediaView {
  return mediaStorage().view(asset);
}

/** Step 1 — validate the request and issue a signature for one upload to a server-chosen public_id. */
export async function createUpload(ownerId: string, input: CreateUploadInput): Promise<SignedUpload> {
  requireConfigured();
  const problem = checkUpload(input.kind, input.purpose, input.bytes);
  if (problem) throw new HttpError(400, 'MEDIA_INVALID', problem);

  const pending = await prisma.mediaAsset.count({ where: { ownerId, status: 'PENDING' } });
  if (pending >= MAX_PENDING_PER_USER) {
    throw new HttpError(429, 'TOO_MANY_PENDING_UPLOADS', 'Finish or cancel your current uploads first.');
  }

  const id = randomUUID();
  const publicId = `${env.CLOUDINARY_FOLDER}/${env.NODE_ENV}/${ownerId}/${id}`;
  await prisma.mediaAsset.create({
    data: {
      id,
      ownerId,
      kind: input.kind,
      purpose: input.purpose,
      publicId,
      originalFilename: input.filename ?? null,
    },
  });

  const signed = mediaStorage().signUpload({
    publicId,
    resourceType: resourceTypeFor(input.kind),
    allowedFormats: MEDIA_RULES[input.kind].formats,
  });
  return {
    assetId: id,
    uploadUrl: signed.uploadUrl,
    fields: signed.fields,
    chunked: input.bytes > CHUNKED_UPLOAD_THRESHOLD,
    chunkBytes: UPLOAD_CHUNK_BYTES,
  };
}

/** Why a stored file doesn't match the rules, or null if it's fine. */
function rejectReason(kind: MediaKind, remote: RemoteResource): string | null {
  const rule = MEDIA_RULES[kind];
  if (remote.resourceType !== resourceTypeFor(kind)) return 'The file type does not match.';
  if (!(rule.formats as readonly string[]).includes(remote.format)) return `.${remote.format} files are not supported here.`;
  if (remote.bytes > rule.maxBytes) return `The file is larger than the ${Math.round(rule.maxBytes / 1048576)} MB limit.`;
  if (rule.maxDurationSec && remote.durationSec && remote.durationSec > rule.maxDurationSec) {
    return `The file is longer than ${rule.maxDurationSec / 60} minutes.`;
  }
  // Cloudinary keeps audio under "video"; a real video has picture dimensions, audio doesn't.
  if (kind === 'AUDIO' && remote.width) return 'This is a video file, not audio.';
  if (kind === 'VIDEO' && !remote.width) return 'This file has no video track.';
  return null;
}

/**
 * Step 2 — after the browser uploads, verify the file Cloudinary actually holds.
 * Only then does the asset become READY (usable). Idempotent for READY assets.
 */
export async function confirmUpload(ownerId: string, assetId: string): Promise<MediaView> {
  requireConfigured();
  // Someone else's asset is reported as missing, so ids can't be probed.
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId } });
  if (!asset) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'Upload not found');
  if (asset.status === 'READY') return toMediaView(asset);
  if (asset.status !== 'PENDING') throw new HttpError(409, 'MEDIA_NOT_PENDING', 'This upload can no longer be confirmed');

  const remote = await mediaStorage().fetchResource(asset.publicId, resourceTypeFor(asset.kind));
  if (!remote) {
    throw new HttpError(409, 'UPLOAD_INCOMPLETE', "The upload hasn't finished. Please try again.");
  }

  const reason = rejectReason(asset.kind, remote);
  if (reason) {
    await releaseAssets([asset.id]);
    throw new HttpError(400, 'MEDIA_REJECTED', reason);
  }

  const ready = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      status: 'READY',
      readyAt: new Date(),
      format: remote.format,
      bytes: remote.bytes,
      width: remote.width,
      height: remote.height,
      durationSec: remote.durationSec,
      version: remote.version,
    },
  });
  return toMediaView(ready);
}

const attachmentInclude = {
  profileAvatar: { select: { userId: true } },
  profileCover: { select: { userId: true } },
  portfolioMedia: { select: { id: true } },
  portfolioCover: { select: { id: true } },
  postMedia: { select: { postId: true } },
} satisfies Prisma.MediaAssetInclude;

function isAttached(asset: Prisma.MediaAssetGetPayload<{ include: typeof attachmentInclude }>) {
  return Boolean(asset.profileAvatar || asset.profileCover || asset.portfolioMedia || asset.portfolioCover || asset.postMedia);
}

/** DELETE /media/:id — discard one of your own uploads that isn't used anywhere. */
export async function deleteOwnAsset(ownerId: string, assetId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId }, include: attachmentInclude });
  if (!asset) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'Media not found');
  if (isAttached(asset)) throw new HttpError(409, 'MEDIA_IN_USE', 'Remove it from where it is used first');
  await releaseAssets([asset.id]);
}

/**
 * Validates that the user may attach this asset here: they own it, it is verified (READY),
 * it was uploaded for this purpose, and it is an allowed kind. "Already used elsewhere" is
 * enforced by unique constraints and surfaces as 409.
 */
export async function requireAttachable(
  ownerId: string,
  assetId: string,
  purpose: MediaPurpose,
  kinds: readonly MediaKind[] = PURPOSE_KINDS[purpose],
  db: Prisma.TransactionClient = prisma,
): Promise<MediaAsset> {
  const asset = await db.mediaAsset.findFirst({ where: { id: assetId, ownerId } });
  if (!asset) throw new HttpError(400, 'MEDIA_INVALID', 'That media item does not exist');
  if (asset.status !== 'READY') throw new HttpError(400, 'MEDIA_NOT_READY', 'That upload has not finished');
  if (asset.purpose !== purpose) throw new HttpError(400, 'MEDIA_INVALID', 'That media item was uploaded for something else');
  if (!kinds.includes(asset.kind)) throw new HttpError(400, 'MEDIA_INVALID', `A ${MEDIA_RULES[asset.kind].label} can't be used here`);
  return asset;
}

/**
 * Removes assets from Cloudinary and the database. Rows are first marked DELETING so a
 * failed Cloudinary call is retried by `npm run media:cleanup` instead of being forgotten.
 */
export async function releaseAssets(assetIds: string[]): Promise<void> {
  const ids = assetIds.filter(Boolean);
  if (ids.length === 0) return;
  await prisma.mediaAsset.updateMany({ where: { id: { in: ids } }, data: { status: 'DELETING' } });
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
  await Promise.all(
    assets.map(async (asset) => {
      try {
        await mediaStorage().destroy(asset.publicId, resourceTypeFor(asset.kind));
        await prisma.mediaAsset.delete({ where: { id: asset.id } });
      } catch (error) {
        console.error(`Media cleanup deferred for ${asset.id}:`, (error as Error).message);
      }
    }),
  );
}

/**
 * Housekeeping (run on a schedule): retries failed deletions, removes uploads that were
 * never confirmed, and removes verified uploads that were never attached to anything.
 */
export async function cleanupMedia(olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  const deleting = await prisma.mediaAsset.findMany({ where: { status: 'DELETING' }, select: { id: true } });
  const stalePending = await prisma.mediaAsset.findMany({
    where: { status: 'PENDING', createdAt: { lt: olderThan } },
    select: { id: true },
  });
  const unattached = (
    await prisma.mediaAsset.findMany({
      where: { status: 'READY', readyAt: { lt: olderThan } },
      include: attachmentInclude,
    })
  ).filter((a) => !isAttached(a));

  const ids = [...deleting, ...stalePending, ...unattached].map((a) => a.id);
  await releaseAssets(ids);
  const remaining = await prisma.mediaAsset.count({ where: { id: { in: ids } } });
  return { attempted: ids.length, removed: ids.length - remaining, failed: remaining };
}
