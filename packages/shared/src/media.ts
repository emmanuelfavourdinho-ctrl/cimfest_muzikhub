import { z } from 'zod';

export const MEDIA_KINDS = ['IMAGE', 'AUDIO', 'VIDEO'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Where an upload will be used. Decides which kinds are allowed. */
export const MEDIA_PURPOSES = ['AVATAR', 'COVER', 'PORTFOLIO', 'POST'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

const MB = 1024 * 1024;

/**
 * Upload limits — the single source of truth for both the browser (early feedback)
 * and the API (enforcement, checked again against what Cloudinary actually stored).
 * Sizes are within Cloudinary's free-plan limits (10 MB images, 100 MB video/audio).
 */
export const MEDIA_RULES = {
  IMAGE: {
    label: 'image',
    maxBytes: 10 * MB,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'],
    accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif',
    maxDurationSec: null,
  },
  AUDIO: {
    label: 'audio file',
    maxBytes: 50 * MB,
    formats: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
    accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac',
    maxDurationSec: 20 * 60,
  },
  VIDEO: {
    label: 'video',
    maxBytes: 100 * MB,
    formats: ['mp4', 'mov', 'webm', 'm4v'],
    accept: 'video/mp4,video/quicktime,video/webm,video/x-m4v',
    maxDurationSec: 10 * 60,
  },
} as const satisfies Record<
  MediaKind,
  { label: string; maxBytes: number; formats: readonly string[]; accept: string; maxDurationSec: number | null }
>;

export const PURPOSE_KINDS: Record<MediaPurpose, readonly MediaKind[]> = {
  AVATAR: ['IMAGE'],
  COVER: ['IMAGE'],
  PORTFOLIO: ['IMAGE', 'AUDIO', 'VIDEO'],
  POST: ['IMAGE', 'AUDIO', 'VIDEO'],
};

/** Files larger than this are uploaded in chunks (Cloudinary requires chunks ≥ 5 MB). */
export const CHUNKED_UPLOAD_THRESHOLD = 20 * MB;
export const UPLOAD_CHUNK_BYTES = 6 * MB;

export function kindFromMime(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Validation shared by browser and server. Returns a user-facing message, or null when OK. */
export function checkUpload(kind: MediaKind, purpose: MediaPurpose, bytes: number): string | null {
  if (!PURPOSE_KINDS[purpose].includes(kind)) {
    return `A ${MEDIA_RULES[kind].label} can't be used here.`;
  }
  const rule = MEDIA_RULES[kind];
  if (bytes > rule.maxBytes) return `This ${rule.label} is ${formatBytes(bytes)}. The limit is ${formatBytes(rule.maxBytes)}.`;
  if (bytes <= 0) return 'This file is empty.';
  return null;
}

// ── Contracts ─────────────────────────────────────────────────

/** POST /api/v1/media/uploads */
export const createUploadSchema = z.strictObject({
  kind: z.enum(MEDIA_KINDS),
  purpose: z.enum(MEDIA_PURPOSES),
  bytes: z.number().int().positive(),
  filename: z.string().trim().max(200).optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

/** Everything the browser needs to upload one file directly to Cloudinary. */
export const signedUploadSchema = z.object({
  assetId: z.string(),
  uploadUrl: z.url(),
  /** Form fields to send with the file, including the server-generated signature. */
  fields: z.record(z.string(), z.string()),
  chunked: z.boolean(),
  chunkBytes: z.number().int().positive(),
});
export type SignedUpload = z.infer<typeof signedUploadSchema>;

/** A ready media item as the browser sees it: delivery URLs only, never credentials. */
export const mediaViewSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSec: z.number().nullable(),
  urls: z.object({
    /** Images: width-limited variants for srcset (c_limit, f_auto, q_auto). */
    small: z.string().optional(), // 320w
    medium: z.string().optional(), // 640w
    /** 960w: the ceiling for feeds and cards, so high-density phones don't fetch 1280w. */
    wide: z.string().optional(),
    large: z.string().optional(), // 1280w — detail pages only
    /** Images: square crop for avatars. */
    square: z.string().optional(),
    /** Video: lightweight still image shown until the user presses play. */
    poster: z.string().optional(),
    /** Audio/video: playable source, fetched only on play. */
    src: z.string().optional(),
  }),
});
export type MediaView = z.infer<typeof mediaViewSchema>;
