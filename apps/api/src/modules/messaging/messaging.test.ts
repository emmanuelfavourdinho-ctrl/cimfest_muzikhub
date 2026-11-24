import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { connect, nextEvent, signUpWithCookie, startRealtimeServer } from '../../test/realtime.js';

const app = testApp();
beforeEach(resetDatabase);
type Agent = ReturnType<typeof request.agent>;
let n = 0;
const cid = () => `client${Date.now().toString(36)}${(n += 1)}`;

const open = (agent: Agent, username: string) => agent.post('/api/v1/conversations').set('Origin', ORIGIN).send({ username });
const send = (agent: Agent, id: string, body: string, clientId = cid()) =>
  agent.post(`/api/v1/conversations/${id}/messages`).set('Origin', ORIGIN).send({ clientId, body });
async function connected() {
  const a = await signUp(app);
  const b = await signUp(app);
  const req = await a.agent.post('/api/v1/connections').set('Origin', ORIGIN).send({ username: b.input.username });
  await b.agent.post(`/api/v1/connections/${req.body.id}/accept`).set('Origin', ORIGIN);
  return { a, b };
}

describe('conversations', () => {
  it('one direct conversation per pair, from either side, even when opened at once', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const [x, y] = await Promise.all([open(a.agent, b.input.username), open(b.agent, a.input.username)]);
    expect(x.body.id).toBe(y.body.id);
    expect(await prisma.conversation.count()).toBe(1);
    expect((await open(a.agent, a.input.username)).status).toBe(400);
    expect((await open(a.agent, 'nobody-here')).status).toBe(404);
  });

  it('only participants can see or write; others get 404', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    await send(a.agent, c, 'Hello');
    const outsider = await signUp(app);
    expect((await outsider.agent.get(`/api/v1/conversations/${c}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/v1/conversations/${c}/messages`)).status).toBe(404);
    expect((await send(outsider.agent, c, 'let me in')).status).toBe(404);
    expect((await request(app).get(`/api/v1/conversations/${c}`)).status).toBe(401);
    expect((await outsider.agent.get('/api/v1/conversations')).body.items).toEqual([]);
  });
});

describe('sending', () => {
  it('persists, orders the list, and a retried send never duplicates', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    const clientId = cid();
    const first = await send(a.agent, c, 'Are you free Friday?', clientId);
    expect(first.status).toBe(201);
    const retry = await send(a.agent, c, 'Are you free Friday?', clientId);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.message.count()).toBe(1);
    const list = await b.agent.get('/api/v1/conversations');
    expect(list.body.items[0]).toMatchObject({ id: c, unread: 1, lastMessage: { body: 'Are you free Friday?', mine: false } });
  });

  it('anti-spam: a stranger can send 3 messages until the other person replies', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const c = (await open(a.agent, b.input.username)).body.id;
    for (let i = 0; i < 3; i += 1) expect((await send(a.agent, c, `hi ${i}`)).status).toBe(201);
    const fourth = await send(a.agent, c, 'hello??');
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('AWAITING_REPLY');
    expect((await a.agent.get(`/api/v1/conversations/${c}`)).body).toMatchObject({ canSend: false });
    await send(b.agent, c, 'Hey, what’s up?');
    expect((await send(a.agent, c, 'Great, thanks!')).status).toBe(201);
  });

  it('blocks stop messages both ways; the conversation shows it', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    await send(a.agent, c, 'hello');
    await b.agent.post('/api/v1/blocks').set('Origin', ORIGIN).send({ username: a.input.username });
    expect((await send(a.agent, c, 'still there?')).body.code).toBe('BLOCKED');
    expect((await send(b.agent, c, 'bye')).body.code).toBe('BLOCKED');
    expect((await open(a.agent, b.input.username)).body.code).toBe('BLOCKED');
    expect((await a.agent.get(`/api/v1/conversations/${c}`)).body).toMatchObject({ blocked: true, canSend: false });
  });

  it('message policy: “connections only” stops strangers starting a conversation', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await b.agent.put('/api/v1/conversations/settings/policy').set('Origin', ORIGIN).send({ policy: 'CONNECTIONS' });
    expect((await open(a.agent, b.input.username)).body.code).toBe('MESSAGES_RESTRICTED');
    await b.agent.put(`/api/v1/users/${a.input.username}/follow`).set('Origin', ORIGIN);
    expect((await open(a.agent, b.input.username)).status).toBe(200);
  });

  it('suspended members can’t receive messages', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    await prisma.user.update({ where: { id: b.userId }, data: { status: 'SUSPENDED' } });
    expect((await send(a.agent, c, 'hello')).body.code).toBe('RECIPIENT_UNAVAILABLE');
  });
});

describe('receipts, catch-up and notifications', () => {
  it('delivered when fetched, read when read; receipts only move forward', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    const m1 = (await send(a.agent, c, 'one')).body;
    const m2 = (await send(a.agent, c, 'two')).body;
    expect((await a.agent.get(`/api/v1/conversations/${c}`)).body.otherDeliveredAt).toBeNull();
    await b.agent.get(`/api/v1/conversations/${c}/messages`);
    const afterFetch = (await a.agent.get(`/api/v1/conversations/${c}`)).body;
    expect(afterFetch.otherDeliveredAt).toBe(m2.createdAt);
    expect(afterFetch.otherReadAt).toBeNull();
    await b.agent.post(`/api/v1/conversations/${c}/read`).set('Origin', ORIGIN).send({ upTo: m2.id });
    await b.agent.post(`/api/v1/conversations/${c}/read`).set('Origin', ORIGIN).send({ upTo: m1.id }); // late, out of order
    expect((await a.agent.get(`/api/v1/conversations/${c}`)).body.otherReadAt).toBe(m2.createdAt);
    expect((await b.agent.get('/api/v1/conversations/unread-count')).body.count).toBe(0);
  });

  it('catch-up returns only what was missed; history pages backwards', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await send(i % 2 ? b.agent : a.agent, c, `m${i}`)).body.id);
    const missed = await b.agent.get(`/api/v1/conversations/${c}/messages?after=${ids[2]}`);
    expect(missed.body.items.map((m: { body: string }) => m.body)).toEqual(['m3', 'm4']);
    const latest = await b.agent.get(`/api/v1/conversations/${c}/messages?limit=2`);
    expect(latest.body.items.map((m: { body: string }) => m.body)).toEqual(['m3', 'm4']);
    const older = await b.agent.get(`/api/v1/conversations/${c}/messages?limit=2&before=${latest.body.items[0].id}`);
    expect(older.body.items.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2']);
  });

  it('one notification per unread streak, linking to the conversation', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    await send(a.agent, c, 'one');
    const m2 = (await send(a.agent, c, 'two')).body;
    const notes = await prisma.notification.findMany({ where: { userId: b.userId, type: 'message.new' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.link).toBe(`/messages/${c}`);
    await b.agent.post(`/api/v1/conversations/${c}/read`).set('Origin', ORIGIN).send({ upTo: m2.id });
    await send(a.agent, c, 'three');
    expect(await prisma.notification.count({ where: { userId: b.userId, type: 'message.new' } })).toBe(2);
  });
});

describe('real-time delivery', () => {
  let rt: Awaited<ReturnType<typeof startRealtimeServer>>;
  beforeEach(async () => {
    rt = await startRealtimeServer(testApp());
  });
  afterEach(async () => rt.close());

  it('pushes a persisted message to both participants and nobody else', async () => {
    const a = await signUpWithCookie(app);
    const b = await signUpWithCookie(app);
    const eve = await signUpWithCookie(app);
    const c = (await open(a.agent, b.input.username)).body.id;
    const sb = await connect(rt.url, b.cookie);
    const se = await connect(rt.url, eve.cookie);
    let leaked = false;
    se.on('message:new', () => (leaked = true));
    const got = nextEvent<{ body: string; mine: boolean; conversationId: string }>(sb, 'message:new');
    await send(a.agent, c, 'live hello');
    expect(await got).toMatchObject({ body: 'live hello', mine: false, conversationId: c });
    expect(await prisma.message.count({ where: { body: 'live hello' } })).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
    sb.disconnect();
    se.disconnect();
  });
});

describe('reporting', () => {
  it('a participant can report a message; staff see it only in the queue and can remove it', async () => {
    const { a, b } = await connected();
    const c = (await open(a.agent, b.input.username)).body.id;
    const m = (await send(a.agent, c, 'nasty message')).body;
    const outsider = await signUp(app);
    expect(
      (
        await outsider.agent
          .post('/api/v1/reports')
          .set('Origin', ORIGIN)
          .send({ targetType: 'MESSAGE', targetId: m.id, reason: 'HARASSMENT' })
      ).status,
    ).toBe(404);
    expect(
      (await b.agent.post('/api/v1/reports').set('Origin', ORIGIN).send({ targetType: 'MESSAGE', targetId: m.id, reason: 'HARASSMENT' }))
        .status,
    ).toBe(201);
    const staff = await makeStaff(app, 'MODERATOR');
    const queue = await staff.agent.get('/api/v1/admin/reports?open=true');
    expect(queue.body.items[0].target).toMatchObject({ exists: true, text: 'nasty message', moderationType: 'message' });
    await staff.agent.post(`/api/v1/admin/content/message/${m.id}/remove`).set('Origin', ORIGIN).send({ reason: 'Harassment' });
    const after = await b.agent.get(`/api/v1/conversations/${c}/messages`);
    expect(after.body.items[0]).toMatchObject({ removed: true, body: 'This message was removed by a moderator.' });
  });
});
