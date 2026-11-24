import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env automatically. Node's built-in loader avoids a dotenv dependency.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional on purpose: `prisma generate` needs no database (CI, fresh clones, builds), while
  // migrate/studio without DATABASE_URL still fail with Prisma's own clear error.
  ...(process.env.DATABASE_URL && { datasource: { url: process.env.DATABASE_URL } }),
});
