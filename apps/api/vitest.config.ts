import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

/**
 * Opt-in live Cloudinary test (CLOUDINARY_LIVE=1): pass through ONLY the CLOUDINARY_*
 * values from apps/api/.env — never the dev DATABASE_URL or other secrets.
 */
function liveCloudinaryEnv(): Record<string, string> {
  if (!existsSync('.env')) return {};
  const parsed = parseEnv(readFileSync('.env', 'utf8')) as Record<string, string>;
  const wanted = (k: string) =>
    (process.env.CLOUDINARY_LIVE === '1' && k.startsWith('CLOUDINARY_')) ||
    // Opt-in live Resend test: only the API key, nothing else.
    (process.env.RESEND_LIVE === '1' && k === 'RESEND_API_KEY');
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => wanted(k)));
}

// Integration tests run against a dedicated database (never the dev database).
// Start it with `npm run db:up` from the repository root.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      // Safe, non-secret values used only by tests.
      BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-real-000000',
      BETTER_AUTH_URL: 'http://localhost:4000',
      CORS_ORIGINS: 'http://localhost:5173',
      WEB_APP_URL: 'http://localhost:5173',
      ...liveCloudinaryEnv(),
    },
  },
});
