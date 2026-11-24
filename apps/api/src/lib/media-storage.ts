import { v2 as cloudinary } from 'cloudinary';
import type { MediaKind, MediaView } from '@muzikhub/shared';
import { env } from '../config/env.js';

/** Cloudinary stores audio AND video under resource_type "video". */
export type ResourceType = 'image' | 'video';
export const resourceTypeFor = (kind: MediaKind): ResourceType => (kind === 'IMAGE' ? 'image' : 'video');

/** What Cloudinary reports about an uploaded file — the facts we verify before trusting it. */
export interface RemoteResource {
  bytes: number;
  format: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  version: number;
  resourceType: ResourceType;
}

export interface StoredAsset {
  id: string;
  kind: MediaKind;
  publicId: string;
  version: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

/**
 * Boundary around the media provider. The API depends on this interface, so tests
 * can use an in-memory fake and the provider could be swapped without touching modules.
 */
export interface MediaStorage {
  readonly configured: boolean;
  /** Signed form fields for one direct browser upload to exactly this public_id. */
  signUpload(input: { publicId: string; resourceType: ResourceType; allowedFormats: readonly string[] }): {
    uploadUrl: string;
    fields: Record<string, string>;
  };
  /** Looks up what was actually uploaded. null = nothing there (upload missing or failed). */
  fetchResource(publicId: string, resourceType: ResourceType): Promise<RemoteResource | null>;
  /** Deletes the asset and purges CDN caches. Succeeds if it is already gone. */
  destroy(publicId: string, resourceType: ResourceType): Promise<void>;
  /** CDN delivery URLs with automatic format/quality and right-sized variants. */
  view(asset: StoredAsset): MediaView;
}

export function cloudinaryStorage(): MediaStorage {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
  const configured = Boolean(cloudName && apiKey && apiSecret);
  if (configured) {
    // analytics:false drops the SDK's `?_a=…` tracking query string: cleaner, more cacheable CDN URLs.
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true, analytics: false });
  }

  const imageUrl = (asset: StoredAsset, transformation: Record<string, unknown>) =>
    cloudinary.url(asset.publicId, {
      resource_type: 'image',
      version: asset.version ?? undefined,
      secure: true,
      transformation: [{ ...transformation, fetch_format: 'auto', quality: 'auto' }],
    });

  return {
    configured,

    signUpload({ publicId, resourceType, allowedFormats }) {
      const params = {
        public_id: publicId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        allowed_formats: allowedFormats.join(','),
        // A leaked/replayed signature can never replace a file after it was verified.
        overwrite: 'false',
      };
      const signature = cloudinary.utils.api_sign_request(params, apiSecret!);
      return {
        uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
        fields: { ...params, api_key: apiKey!, signature },
      };
    },

    async fetchResource(publicId, resourceType) {
      try {
        const r = await cloudinary.api.resource(publicId, { resource_type: resourceType });
        return {
          bytes: r.bytes,
          format: String(r.format ?? '').toLowerCase(),
          width: r.width ?? null,
          height: r.height ?? null,
          durationSec: typeof r.duration === 'number' ? r.duration : null,
          version: r.version,
          resourceType: r.resource_type,
        };
      } catch (error) {
        const status = (error as { error?: { http_code?: number } }).error?.http_code;
        if (status === 404) return null;
        throw error;
      }
    },

    async destroy(publicId, resourceType) {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
      if (result.result !== 'ok' && result.result !== 'not found') {
        throw new Error(`Cloudinary destroy failed: ${result.result}`);
      }
    },

    view(asset) {
      const base = { id: asset.id, kind: asset.kind, width: asset.width, height: asset.height, durationSec: asset.durationSec };
      if (asset.kind === 'IMAGE') {
        return {
          ...base,
          urls: {
            small: imageUrl(asset, { width: 320, crop: 'limit' }),
            medium: imageUrl(asset, { width: 640, crop: 'limit' }),
            wide: imageUrl(asset, { width: 960, crop: 'limit' }),
            large: imageUrl(asset, { width: 1280, crop: 'limit' }),
            square: imageUrl(asset, { width: 192, height: 192, crop: 'fill', gravity: 'auto' }),
          },
        };
      }
      if (asset.kind === 'VIDEO') {
        return {
          ...base,
          urls: {
            poster: cloudinary.url(asset.publicId, {
              resource_type: 'video',
              version: asset.version ?? undefined,
              secure: true,
              format: 'jpg',
              transformation: [{ start_offset: 'auto', width: 960, crop: 'limit', quality: 'auto' }],
            }),
            src: cloudinary.url(asset.publicId, {
              resource_type: 'video',
              version: asset.version ?? undefined,
              secure: true,
              format: 'mp4',
              transformation: [{ width: 1280, crop: 'limit', quality: 'auto', video_codec: 'auto' }],
            }),
          },
        };
      }
      // Audio: transcode to a widely supported, compact MP3 (also turns WAV uploads into small files).
      return {
        ...base,
        urls: {
          src: cloudinary.url(asset.publicId, {
            resource_type: 'video',
            version: asset.version ?? undefined,
            secure: true,
            format: 'mp3',
            transformation: [{ bit_rate: '128k' }],
          }),
        },
      };
    },
  };
}
