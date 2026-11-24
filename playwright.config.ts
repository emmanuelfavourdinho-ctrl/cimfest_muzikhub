import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

/** Real Cloudinary for browser uploads — ONLY the CLOUDINARY_* values from apps/api/.env. */
const cloudinaryEnv: Record<string, string> = existsSync('apps/api/.env')
  ? Object.fromEntries(
      Object.entries(parseEnv(readFileSync('apps/api/.env', 'utf8')) as Record<string, string>).filter(([k]) =>
        k.startsWith('CLOUDINARY_'),
      ),
    )
  : {};

/**
 * End-to-end tests drive a real browser against a real API and database.
 * They start their own servers on ports 4100 (API) and 5273 (web) against the
 * *_test database, so they never touch your dev data or dev servers.
 * Prerequisite: `npm run db:up`.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';
const WEB_URL = 'http://localhost:5273';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Deletes everything uploaded under muzikhub/test/ during the run.
  globalTeardown: './e2e/teardown.ts',
  timeout: 90_000,
  use: { baseURL: WEB_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'npx prisma migrate deploy && npx tsx src/server.ts',
      cwd: './apps/api',
      url: 'http://localhost:4100/api/v1/health',
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test', // captured emails, no rate limiting, does not read apps/api/.env
        PORT: '4100',
        DATABASE_URL: TEST_DATABASE_URL,
        BETTER_AUTH_SECRET: 'e2e-only-secret-not-used-anywhere-real-0000000',
        BETTER_AUTH_URL: 'http://localhost:4100',
        CORS_ORIGINS: WEB_URL,
        WEB_APP_URL: WEB_URL,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
        ...cloudinaryEnv,
      },
    },
    {
      // Production build, served like real users get it (bundled, minified, code-split).
      command: 'npx vite build --logLevel warn && npx vite preview --port 5273 --strictPort',
      cwd: './apps/web',
      url: WEB_URL,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://localhost:4100' },
    },
  ],
});
