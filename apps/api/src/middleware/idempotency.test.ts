import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { resetDatabase, signUp, testApp } from '../test/helpers.js';
import { sweepIdempotencyKeys } from './idempotency.js';

describe('Idempotency-Key (ADR 0003)', () => {
  const app = testApp();
  beforeEach(resetDatabase);

  it('a retried create with the same key returns the first result and creates nothing new', async () => {
    const { agent } = await signUp(app);
    const first = await agent.post('/api/v1/posts').set('Idempotency-Key', 'post-key-0001').send({ body: 'once only' });
    expect(first.status).toBe(201);
    const retry = await agent.post('/api/v1/posts').set('Idempotency-Key', 'post-key-0001').send({ body: 'once only' });
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.post.count()).toBe(1);
  });

  it('the same key with a different body is refused (422), and nothing is created', async () => {
    const { agent } = await signUp(app);
    await agent.post('/api/v1/posts').set('Idempotency-Key', 'post-key-0002').send({ body: 'first' });
    const res = await agent.post('/api/v1/posts').set('Idempotency-Key', 'post-key-0002').send({ body: 'second' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.post.count()).toBe(1);
  });

  it('keys are per user: another member may use the same key', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await a.agent.post('/api/v1/posts').set('Idempotency-Key', 'shared-key-01').send({ body: 'a' });
    const res = await b.agent.post('/api/v1/posts').set('Idempotency-Key', 'shared-key-01').send({ body: 'a' });
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await prisma.post.count()).toBe(2);
  });

  it('a failed request releases its key, so the corrected retry can use it', async () => {
    const { agent } = await signUp(app);
    const bad = await agent.post('/api/v1/connections').set('Idempotency-Key', 'conn-key-0001').send({ username: 'nobody.here' });
    expect(bad.status).toBe(404);
    await expect.poll(() => prisma.idempotencyKey.count()).toBe(0);
    const other = await signUp(app);
    const ok = await agent.post('/api/v1/connections').set('Idempotency-Key', 'conn-key-0001').send({ username: other.input.username });
    expect(ok.status).toBe(201);
  });

  it('concurrent duplicates: exactly one is processed, the other is told it is in progress or replayed', async () => {
    const { agent } = await signUp(app);
    const send = () => agent.post('/api/v1/posts').set('Idempotency-Key', 'race-key-0001').send({ body: 'double tap' });
    const [r1, r2] = await Promise.all([send(), send()]);
    expect([r1.status, r2.status].sort()).toEqual(expect.arrayContaining([201]));
    expect([r1.status, r2.status].every((s) => s === 201 || s === 409)).toBe(true);
    expect(await prisma.post.count()).toBe(1);
  });

  it('rejects malformed keys and works without a key (optional for now)', async () => {
    const { agent } = await signUp(app);
    expect((await agent.post('/api/v1/posts').set('Idempotency-Key', 'short').send({ body: 'x' })).body.code).toBe(
      'IDEMPOTENCY_KEY_INVALID',
    );
    expect((await agent.post('/api/v1/posts').send({ body: 'no key' })).status).toBe(201);
  });

  it('expired keys are swept', async () => {
    const { agent } = await signUp(app);
    await agent
      .post('/api/v1/reports')
      .set('Idempotency-Key', 'report-key-01')
      .send({ targetType: 'PROFILE', targetId: 'missing', reason: 'SPAM' });
    await agent.post('/api/v1/posts').set('Idempotency-Key', 'sweep-key-0001').send({ body: 'kept a day' });
    await expect.poll(() => prisma.idempotencyKey.count({ where: { status: 'COMPLETED' } })).toBe(1);
    expect(await sweepIdempotencyKeys(new Date(Date.now() + 25 * 60 * 60 * 1000))).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });
});
