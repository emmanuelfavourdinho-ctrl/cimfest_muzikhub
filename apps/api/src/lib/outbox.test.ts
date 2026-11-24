import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backoffMs, clearOutboxHandlers, dispatchOutbox, enqueue, MAX_ATTEMPTS, registerOutboxHandler } from './outbox.js';
import { prisma } from './prisma.js';
import { resetDatabase } from '../test/helpers.js';

describe('transactional outbox (ADR 0003)', () => {
  beforeEach(resetDatabase);
  afterEach(clearOutboxHandlers);

  it('an event exists only if its transaction commits', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueue(tx, 'test.committed', { n: 1 });
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueue(tx, 'test.rolled-back', { n: 2 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await prisma.outboxEvent.findMany()).map((e) => e.topic)).toEqual(['test.committed']);
  });

  it('delivers due events to their handler once and marks them DONE', async () => {
    const seen: unknown[] = [];
    registerOutboxHandler('test.hello', async (payload) => {
      seen.push(payload);
    });
    await enqueue(prisma, 'test.hello', { to: 'world' });
    await enqueue(prisma, 'test.hello', { later: true }, { availableAt: new Date(Date.now() + 60_000) });
    expect(await dispatchOutbox()).toBe(1);
    expect(seen).toEqual([{ to: 'world' }]);
    expect(await dispatchOutbox()).toBe(0); // the future one isn't due; the done one isn't re-sent
    expect(await prisma.outboxEvent.count({ where: { status: 'DONE' } })).toBe(1);
  });

  it('retries failures with backoff and gives up after MAX_ATTEMPTS (kept as FAILED)', async () => {
    let calls = 0;
    registerOutboxHandler('test.flaky', async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    });
    const e = await enqueue(prisma, 'test.flaky', {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await prisma.outboxEvent.update({ where: { id: e.id }, data: { availableAt: new Date(0) } }); // skip the wait
      await dispatchOutbox();
    }
    const final = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(final).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, lastError: `fail ${MAX_ATTEMPTS}` });
    expect(calls).toBe(MAX_ATTEMPTS);
  });

  it('an event with no handler is retried, not lost', async () => {
    const e = await enqueue(prisma, 'test.unhandled', {});
    await dispatchOutbox();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: 'PENDING', attempts: 1 });
  });

  it('reclaims events abandoned by a crashed worker', async () => {
    registerOutboxHandler('test.crashed', async () => {});
    const e = await enqueue(prisma, 'test.crashed', {});
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { status: 'PROCESSING', lockedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await dispatchOutbox()).toBe(1);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('DONE');
  });

  it('two workers never deliver the same event twice (SKIP LOCKED)', async () => {
    const delivered: string[] = [];
    registerOutboxHandler('test.parallel', async (p) => {
      delivered.push((p as { i: number }).i.toString());
      await new Promise((r) => setTimeout(r, 20));
    });
    for (let i = 0; i < 10; i++) await enqueue(prisma, 'test.parallel', { i });
    await Promise.all([dispatchOutbox({ limit: 10 }), dispatchOutbox({ limit: 10 })]);
    expect(delivered.sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('backoff grows exponentially with jitter and is capped', () => {
    expect(backoffMs(1, () => 0.5)).toBe(2000);
    expect(backoffMs(5, () => 0.5)).toBe(32000);
    expect(backoffMs(30, () => 0.5)).toBe(30 * 60 * 1000);
    expect(backoffMs(3, () => 0)).toBe(6400);
    expect(backoffMs(3, () => 1)).toBe(9600);
  });
});
