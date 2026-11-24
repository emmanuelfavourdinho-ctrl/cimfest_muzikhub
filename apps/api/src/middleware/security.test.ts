import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { limits } from '../lib/rate-limit.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../test/helpers.js';

const app = testApp();
const WEB = ORIGIN; // the web app origin, in CORS_ORIGINS for tests

describe('CSRF origin check on /api/v1', () => {
  beforeEach(resetDatabase);

  it('rejects a state-changing request from a foreign Origin, even with a valid session', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/posts').set('Origin', 'https://evil.example').send({ body: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'CROSS_ORIGIN_REJECTED', status: 403 });
  });

  it('rejects cross-site Fetch Metadata without an Origin header', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/posts').set('Sec-Fetch-Site', 'cross-site').send({ body: 'hi' });
    expect(res.status).toBe(403);
    expect((await agent.post('/api/v1/posts').set('Sec-Fetch-Site', 'same-site').send({ body: 'hi' })).status).toBe(403);
  });

  it('allows the web app origin and same-origin requests', async () => {
    const { agent } = await signUp(app);
    expect((await agent.post('/api/v1/posts').set('Origin', WEB).send({ body: 'from the app' })).status).toBe(201);
    expect((await agent.post('/api/v1/posts').set('Sec-Fetch-Site', 'same-origin').send({ body: 'same origin' })).status).toBe(201);
  });

  it('never blocks safe methods', async () => {
    expect((await request(app).get('/api/v1/health').set('Origin', 'https://evil.example')).status).toBe(200);
  });

  it('rejects the opaque "null" origin (sandboxed iframes, data: URLs)', async () => {
    const { agent } = await signUp(app);
    expect((await agent.post('/api/v1/posts').set('Origin', 'null').send({ body: 'x' })).status).toBe(403);
  });
});

describe('rate limits on member write routes', () => {
  beforeEach(resetDatabase);

  it('content writes: 21st post in a minute → 429 with Retry-After, as a problem document', async () => {
    const { agent } = await signUp(app);
    for (let i = 0; i < 20; i++) expect((await agent.post('/api/v1/posts').send({ body: `post ${i}` })).status).toBe(201);
    const res = await agent.post('/api/v1/posts').send({ body: 'one too many' });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('limits are per user: another member is unaffected', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    for (let i = 0; i < 20; i++) await a.agent.post('/api/v1/posts').send({ body: `a ${i}` });
    expect((await a.agent.post('/api/v1/posts').send({ body: 'blocked' })).status).toBe(429);
    expect((await b.agent.post('/api/v1/posts').send({ body: 'fine' })).status).toBe(201);
  });

  it('reports: 20 per hour', async () => {
    const { agent } = await signUp(app);
    const target = await signUp(app);
    const post = (await target.agent.post('/api/v1/posts').send({ body: 'target' })).body;
    // Duplicate reports are rejected by the service, so count requests rather than successes.
    for (let i = 0; i < 20; i++) await agent.post('/api/v1/reports').send({ targetType: 'POST', targetId: post.id, reason: 'SPAM' });
    expect((await agent.post('/api/v1/reports').send({ targetType: 'POST', targetId: post.id, reason: 'SPAM' })).status).toBe(429);
  });

  it('every member write class is registered with explicit windows', () => {
    expect(Object.fromEntries(Object.entries(limits).map(([k, l]) => [k, l.windows.map((w) => `${w.max}/${w.ms / 60000}min`)]))).toEqual({
      contentWrite: ['20/1min', '200/60min'],
      reaction: ['60/1min'],
      connectionRequest: ['30/60min'],
      report: ['20/60min'],
      upload: ['60/60min'],
      apply: ['30/60min'],
      checkout: ['5/1min', '30/60min'],
      webhook: ['300/1min'],
      catalogueRead: ['120/1min'],
    });
  });
});
