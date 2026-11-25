import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { connect, nextEvent, signUpWithCookie, startRealtimeServer } from '../../test/realtime.js';
import { notify } from '../notifications/notifications.service.js';

const app = testApp();
beforeEach(resetDatabase);

describe('blocking (PROF-006, MSG-003)', () => {
  it('blocks stop follows and connection requests both ways, end existing ties, and stay neutral', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await a.agent.put(`/api/v1/users/${b.input.username}/follow`).set('Origin', ORIGIN);
    await b.agent.put(`/api/v1/users/${a.input.username}/follow`).set('Origin', ORIGIN);
    expect(await prisma.follow.count()).toBe(2);
    expect((await a.agent.post('/api/v1/blocks').set('Origin', ORIGIN).send({ username: b.input.username })).status).toBe(201);
    expect(await prisma.follow.count()).toBe(0);

    const follow = await b.agent.put(`/api/v1/users/${a.input.username}/follow`).set('Origin', ORIGIN);
    expect(follow.status).toBe(403);
    expect(follow.body).toMatchObject({ code: 'BLOCKED', detail: "You can't interact with this member." });
    const connect = await b.agent.post('/api/v1/connections').set('Origin', ORIGIN).send({ username: a.input.username });
    expect(connect.body.code).toBe('BLOCKED');

    const rel = await b.agent.get(`/api/v1/users/${a.input.username}/relationship`);
    expect(rel.body).toMatchObject({ blocked: true, blockedByMe: false });
    expect((await a.agent.get(`/api/v1/users/${b.input.username}/relationship`)).body).toMatchObject({ blocked: true, blockedByMe: true });

    expect((await a.agent.get('/api/v1/blocks')).body.items.map((p: { username: string }) => p.username)).toEqual([b.input.username]);
    await a.agent.delete(`/api/v1/blocks/${b.input.username}`).set('Origin', ORIGIN);
    expect((await b.agent.put(`/api/v1/users/${a.input.username}/follow`).set('Origin', ORIGIN)).status).toBe(200);
  });

  it('you can’t block yourself; signed out → 401', async () => {
    const a = await signUp(app);
    expect((await a.agent.post('/api/v1/blocks').set('Origin', ORIGIN).send({ username: a.input.username })).status).toBe(400);
    expect((await request(app).get('/api/v1/blocks')).status).toBe(401);
  });
});

describe('network notifications and preferences (MSG-005, MSG-006)', () => {
  it('connection requests, acceptance and follows notify; a category can be turned off', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const req = await a.agent.post('/api/v1/connections').set('Origin', ORIGIN).send({ username: b.input.username });
    await b.agent.post(`/api/v1/connections/${req.body.id}/accept`).set('Origin', ORIGIN);
    expect((await b.agent.get('/api/v1/notifications')).body.items.map((n: { type: string }) => n.type)).toContain('connection.request');
    expect((await a.agent.get('/api/v1/notifications')).body.items.map((n: { type: string }) => n.type)).toContain('connection.accepted');

    const settings = await b.agent.get('/api/v1/notifications/settings');
    expect(settings.body.settings.find((s: { category: string }) => s.category === 'NETWORK')).toEqual({
      category: 'NETWORK',
      inApp: true,
    });
    await b.agent
      .put('/api/v1/notifications/settings')
      .set('Origin', ORIGIN)
      .send({ settings: [{ category: 'NETWORK', inApp: false }] });
    await a.agent.put(`/api/v1/users/${b.input.username}/follow`).set('Origin', ORIGIN);
    expect(await prisma.notification.count({ where: { userId: b.userId, type: 'follow.new' } })).toBe(0);
    // Payments and plans can't be switched off.
    await notify(prisma, b.userId, { type: 'payment.fulfilled', title: 'x', body: 'y' });
    expect(await prisma.notification.count({ where: { userId: b.userId, type: 'payment.fulfilled' } })).toBe(1);
  });
});

describe('realtime channel', () => {
  let rt: Awaited<ReturnType<typeof startRealtimeServer>>;
  beforeEach(async () => {
    rt = await startRealtimeServer(testApp());
  });
  afterEach(async () => rt.close());

  it('accepts only an authenticated session from an allowed origin, and pushes to that user only', async () => {
    await expect(connect(rt.url)).rejects.toThrow(/unauthenticated/);
    const a = await signUpWithCookie(app);
    const b = await signUpWithCookie(app);
    const sa = await connect(rt.url, a.cookie);
    const sb = await connect(rt.url, b.cookie);
    let bGot = false;
    sb.on('notification', () => (bGot = true));
    const got = nextEvent<{ type: string }>(sa, 'notification');
    await notify(prisma, a.userId, { type: 'community.test', title: 't', body: 'b' });
    expect((await got).type).toBe('community.test');
    await new Promise((r) => setTimeout(r, 200));
    expect(bGot).toBe(false);
    sa.disconnect();
    sb.disconnect();
  });
});
