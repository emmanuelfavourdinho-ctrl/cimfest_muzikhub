import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../lib/realtime.js';
import type { NotificationCategory } from '../../generated/prisma/client.js';
import { NOTIFICATION_CATEGORY_KEYS } from '@muzikhub/shared';

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

/** Which preference controls a notification type. null = always on (payments, plans, safety). */
export function categoryOf(type: string): NotificationCategory | null {
  const prefix = type.split('.')[0];
  const map: Record<string, NotificationCategory> = {
    message: 'MESSAGES',
    community: 'COMMUNITIES',
    collaboration: 'COLLABORATION',
    competition: 'COMPETITIONS',
    connection: 'NETWORK',
    follow: 'NETWORK',
    promotion: 'PROMOTIONS',
  };
  return map[prefix ?? ''] ?? null;
}

export async function notify(db: Db, userId: string, n: NewNotification) {
  const category = categoryOf(n.type);
  if (category) {
    const setting = await db.notificationSetting.findUnique({ where: { userId_category: { userId, category } } });
    if (setting && !setting.inApp) return;
  }
  // A hint for open tabs to refresh their badge; harmless if the surrounding transaction rolls back.
  setImmediate(() => emitToUser(userId, 'notification', { type: n.type }));
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

/** Every category with its current setting (missing row = on). */
export async function getSettings(userId: string) {
  const rows = await prisma.notificationSetting.findMany({ where: { userId } });
  const byCat = new Map(rows.map((r) => [r.category, r.inApp]));
  return { settings: NOTIFICATION_CATEGORY_KEYS.map((category) => ({ category, inApp: byCat.get(category) ?? true })) };
}

export async function updateSettings(userId: string, settings: { category: NotificationCategory; inApp: boolean }[]) {
  await prisma.$transaction(
    settings.map((s) =>
      prisma.notificationSetting.upsert({
        where: { userId_category: { userId, category: s.category } },
        create: { userId, category: s.category, inApp: s.inApp },
        update: { inApp: s.inApp },
      }),
    ),
  );
  return getSettings(userId);
}
