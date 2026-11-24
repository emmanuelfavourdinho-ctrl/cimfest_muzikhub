import { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

/**
 * Transactional outbox (ADR 0003). A feature writes an event in the SAME transaction as the
 * change it describes, so the event exists if and only if the change committed:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const c = await tx.connection.create(...);
 *     await enqueue(tx, 'connection.requested', { connectionId: c.id });
 *   });
 *
 * A worker (server.ts) claims due events with FOR UPDATE SKIP LOCKED (safe with several
 * workers), runs the topic's handler, and marks it DONE — or retries with exponential
 * backoff and jitter, giving up (FAILED, kept for inspection) after MAX_ATTEMPTS.
 * Handlers must be idempotent: an event can be delivered more than once after a crash.
 */
export type OutboxHandler = (payload: unknown, event: { id: string; topic: string; attempts: number }) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();
export const MAX_ATTEMPTS = 8;
/** A PROCESSING event older than this was abandoned by a crashed worker and is reclaimed. */
const STALE_LOCK_MS = 5 * 60 * 1000;

export function registerOutboxHandler(topic: string, handler: OutboxHandler) {
  if (handlers.has(topic)) throw new Error(`outbox handler already registered for ${topic}`);
  handlers.set(topic, handler);
}
/** Tests only. */
export function clearOutboxHandlers() {
  handlers.clear();
}

type Tx = Prisma.TransactionClient | typeof prisma;
export async function enqueue(tx: Tx, topic: string, payload: Prisma.InputJsonValue, opts: { availableAt?: Date } = {}) {
  return tx.outboxEvent.create({ data: { topic, payload, ...(opts.availableAt && { availableAt: opts.availableAt }) } });
}

/** Retry delay: 2^attempts seconds (capped at 30 min) with ±20% jitter. */
export function backoffMs(attempts: number, random = Math.random) {
  const base = Math.min(2 ** attempts * 1000, 30 * 60 * 1000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Claims and delivers up to `limit` due events. Returns how many were processed. */
export async function dispatchOutbox({ limit = 20, now = new Date() }: { limit?: number; now?: Date } = {}) {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const claimed = await prisma.$queryRaw<{ id: string; topic: string; payload: unknown; attempts: number }[]>`
    UPDATE "outbox_event" SET "status" = 'PROCESSING', "lockedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "outbox_event"
      WHERE ("status" = 'PENDING' AND "availableAt" <= ${now})
         OR ("status" = 'PROCESSING' AND "lockedAt" < ${staleBefore})
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "topic", "payload", "attempts"`;

  for (const event of claimed) {
    const handler = handlers.get(event.topic);
    try {
      if (!handler) throw new Error(`no outbox handler for topic "${event.topic}"`);
      await handler(event.payload, event);
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'DONE', processedAt: new Date(), lockedAt: null } });
    } catch (error) {
      const attempts = event.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          attempts,
          lockedAt: null,
          lastError: String((error as Error)?.message ?? error).slice(0, 500),
          ...(!failed && { availableAt: new Date(Date.now() + backoffMs(attempts)) }),
        },
      });
    }
  }
  return claimed.length;
}
