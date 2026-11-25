import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

/** Database time (never the client's or this server's clock). Inside a transaction: its start time. */
export async function dbNow(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<Date> {
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
  return row!.now;
}
