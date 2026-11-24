import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';

/**
 * In-app notifications, created ONLY by server-side events (payments, subscriptions,
 * promotions so far). Never from the browser. Email is not used: the sending domain isn't
 * verified yet, so nothing here promises an email.
 */
type Db = Prisma.TransactionClient | typeof prisma;
export interface NewNotification {
  type: string;
  title: string;
  body: string;
  /** In-app path (DB CHECK: must start with a single "/"). */
  link?: string;
  /** Set to make it "at most once" (e.g. one expiry reminder per period). */
  dedupeKey?: string;
}

export async function notify(db: Db, userId: string, n: NewNotification) {
  if (n.dedupeKey) {
    // ON CONFLICT DO NOTHING: safe inside a caller's transaction (no aborted-transaction error).
    await db.$executeRaw`
      INSERT INTO "notification" ("id", "userId", "type", "title", "body", "link", "dedupeKey", "createdAt")
      VALUES (${crypto.randomUUID()}, ${userId}, ${n.type}, ${n.title}, ${n.body}, ${n.link ?? null}, ${n.dedupeKey}, now())
      ON CONFLICT ("dedupeKey") DO NOTHING`;
    return;
  }
  await db.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null } });
}

export async function listNotifications(userId: string, q: { cursor?: string; limit: number }) {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
  });
  const page = rows.slice(0, q.limit);
  return {
    nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export const unreadCount = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });

export async function markRead(userId: string, ids: string[] | 'all') {
  if (ids !== 'all' && ids.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Nothing to mark');
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids !== 'all' && { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
