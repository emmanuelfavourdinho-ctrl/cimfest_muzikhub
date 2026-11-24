import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { v2 as cloudinary } from 'cloudinary';

/** Removes every asset the browser tests uploaded (they all live under muzikhub/test/). */
export default async function teardown() {
  if (!existsSync('apps/api/.env')) return;
  const env = parseEnv(readFileSync('apps/api/.env', 'utf8')) as Record<string, string>;
  if (!env.CLOUDINARY_API_SECRET) return;
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  for (const resource_type of ['image', 'video'] as const) {
    await cloudinary.api.delete_resources_by_prefix('muzikhub/test/', { resource_type });
  }
}
