import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

// One PrismaClient (and connection pool) per process.
// Creating the client does not open a connection; the first query does.
// DATABASE_URL has already been checked by config/env.ts: remote hosts use sslmode=verify-full
// with an absolute sslrootcert, so node-postgres verifies the certificate chain and host name.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });

export const prisma = new PrismaClient({ adapter });
