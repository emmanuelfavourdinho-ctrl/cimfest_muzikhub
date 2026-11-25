import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { errorHandler } from '../middleware/error-handler.js';
import { fakeMedia, newUserInput, ORIGIN, resetDatabase } from '../test/helpers.js';
import { connect, nextEvent, signUpWithCookie, startRealtimeServer } from '../test/realtime.js';
import { prisma } from './prisma.js';
import { emitToUser } from './realtime.js';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, proxyGate } from './proxy-gate.js';

/**
 * Setup B: Vercel forwards /api to Render and adds the shared secret. Direct requests are refused,
 * and both rate limiters (ours via req.ip, Better Auth via CLIENT_IP_HEADER) see the visitor's IP
 * from X-Real-IP instead of one shared address.
 */
const SECRET = 'test-proxy-secret-'.padEnd(48, 'x');
const VISITOR = '203.0.113.7';
const viaVercel = { [PROXY_SECRET_HEADER]: SECRET, 'x-real-ip': VISITOR, 'x-forwarded-for': `${VISITOR}, 76.76.21.21` };

const proxied = createApp({ checkDatabase: async () => true, media: fakeMedia, proxySecret: SECRET });
const direct = createApp({ checkDatabase: async () => true, media: fakeMedia, proxySecret: undefined });

/** What the rest of the app sees after the gate. */
function echoApp(secret: string | undefined) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(proxyGate(secret));
  app.get('/api/v1/echo', (req, res) => {
    res.json({ ip: req.ip, clientIpHeader: req.headers[CLIENT_IP_HEADER] ?? null, secretHeader: req.headers[PROXY_SECRET_HEADER] ?? null });
  });
  app.use(errorHandler);
  return app;
}

beforeEach(resetDatabase);

describe('proxy gate (setup B)', () => {
  it('refuses requests that bypass Vercel, on the REST API and on Better Auth', async () => {
    for (const path of ['/api/v1/capabilities', '/api/v1/feed', '/api/auth/get-session']) {
      const res = await request(proxied).get(path).set('x-real-ip', VISITOR);
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe('DIRECT_ACCESS_FORBIDDEN');
    }
    const wrong = await request(proxied).get('/api/v1/capabilities').set(PROXY_SECRET_HEADER, `${SECRET}-nope`);
    expect(wrong.status).toBe(403);
    const signUp = await request(proxied).post('/api/auth/sign-up/email').set('Origin', ORIGIN).send(newUserInput());
    expect(signUp.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it('lets the health check through without the secret (Render calls it directly)', async () => {
    expect((await request(proxied).get('/api/v1/health')).status).toBe(200);
  });

  it('accepts forwarded requests and uses X-Real-IP as the client address; the secret goes no further', async () => {
    const res = await request(echoApp(SECRET)).get('/api/v1/echo').set(viaVercel);
    expect(res.body).toEqual({ ip: VISITOR, clientIpHeader: VISITOR, secretHeader: null });
    expect((await request(proxied).get('/api/v1/capabilities').set(viaVercel)).status).toBe(200);
  });

  it('Better Auth records the visitor address (its rate limit buckets per visitor, not one shared bucket)', async () => {
    const res = await request(proxied).post('/api/auth/sign-up/email').set('Origin', ORIGIN).set(viaVercel).send(newUserInput());
    expect(res.status).toBe(200);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: res.body.user.id } });
    expect(session.ipAddress).toBe(VISITOR);
  });

  it('a client-supplied client-IP header is discarded, with or without the proxy', async () => {
    const forged = { [CLIENT_IP_HEADER]: '198.51.100.99' };
    const a = await request(echoApp(undefined)).get('/api/v1/echo').set(forged);
    expect(a.body.clientIpHeader).not.toBe('198.51.100.99');
    expect(a.body.clientIpHeader).toBe(a.body.ip);
    const b = await request(echoApp(SECRET))
      .get('/api/v1/echo')
      .set({ ...viaVercel, ...forged });
    expect(b.body.clientIpHeader).toBe(VISITOR);

    const res = await request(direct).post('/api/auth/sign-up/email').set('Origin', ORIGIN).set(forged).send(newUserInput());
    expect(res.status).toBe(200);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: res.body.user.id } });
    expect(session.ipAddress).not.toBe('198.51.100.99');
  });

  it('without PROXY_SHARED_SECRET (local development, setup A) nothing is gated', async () => {
    expect((await request(direct).get('/api/v1/capabilities')).status).toBe(200);
  });

  it('API responses are never cacheable by a proxy, unless a route says otherwise', async () => {
    expect((await request(direct).get('/api/v1/health')).headers['cache-control']).toBe('no-store');
    expect((await request(direct).get('/api/v1/feed')).headers['cache-control']).toBe('no-store');
    expect((await request(direct).get('/api/v1/capabilities')).headers['cache-control']).toBe('no-cache');
  });
});

describe('real-time through the proxy (setup B)', () => {
  let rt: Awaited<ReturnType<typeof startRealtimeServer>>;
  beforeEach(async () => {
    rt = await startRealtimeServer(proxied, { proxySecret: SECRET });
  });
  afterEach(async () => {
    await rt.close();
  });

  it('long-polling works with the secret, delivers events, and is marked no-store', async () => {
    const { cookie, userId } = await signUpWithCookie(direct);
    const socket = await connect(rt.url, cookie, { headers: viaVercel, transports: ['polling'] });
    try {
      expect(socket.io.engine.transport.name).toBe('polling');
      const event = nextEvent<{ ok: boolean }>(socket, 'notification');
      emitToUser(userId, 'notification', { ok: true });
      expect(await event).toEqual({ ok: true });
    } finally {
      socket.disconnect();
    }
    const handshake = await fetch(`${rt.url}/api/realtime/?EIO=4&transport=polling`, { headers: viaVercel });
    expect(handshake.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a direct connection without the secret', async () => {
    const { cookie } = await signUpWithCookie(direct);
    await expect(connect(rt.url, cookie, { transports: ['polling'] })).rejects.toThrow();
    await expect(connect(rt.url, cookie)).rejects.toThrow();
  });
});
