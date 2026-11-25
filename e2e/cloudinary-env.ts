import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Real Cloudinary for browser uploads — ONLY CLOUDINARY_* values, from apps/api/.env locally or
 * from the environment in CI (repository secrets). Never the dev DATABASE_URL or other secrets.
 */
const fromFile: Record<string, string> = existsSync('apps/api/.env')
  ? (parseEnv(readFileSync('apps/api/.env', 'utf8')) as Record<string, string>)
  : {};
const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_FOLDER'];
export const cloudinaryEnv: Record<string, string> = Object.fromEntries(
  keys.map((k) => [k, fromFile[k] || process.env[k] || '']).filter(([, v]) => v),
);
export const hasCloudinary = Boolean(
  cloudinaryEnv.CLOUDINARY_CLOUD_NAME && cloudinaryEnv.CLOUDINARY_API_KEY && cloudinaryEnv.CLOUDINARY_API_SECRET,
);
export const NEEDS_CLOUDINARY = 'needs CLOUDINARY_* (apps/api/.env locally, repository secrets in CI)';
