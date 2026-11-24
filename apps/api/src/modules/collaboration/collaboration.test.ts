import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);
type Agent = ReturnType<typeof request.agent>;

const body = (username: string, extra: object = {}) => ({
  username,
  type: 'FEATURE',
  title: 'Afro-soul single',
  description: 'A slow afro-soul single about Douala nights; I have the beat and the first verse.',
  role: 'Hook vocals',
  references: ['https://soundcloud.com/me/demo'],
  ...extra,
});
const post = (agent: Agent, path: string, b: object = {}) => agent.post(`/api/v1/collaborations${path}`).set('Origin', ORIGIN).send(b);
const types = async (userId: string) => (await prisma.notification.findMany({ where: { userId } })).map((n) => n.type);

describe('collaboration requests (COL-001–007)', () => {
  it('full lifecycle: request → clarification → answer → accept → collaboration record; cards in their conversation', async () => {
    const ade = await signUp(app);
    const bisi = await signUp(app);
    const r = await post(ade.agent, '/requests', body(bisi.input.username));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'PENDING', direction: 'sent', actions: ['cancel'] });
    expect(await types(bisi.userId)).toContain('collaboration.request');
    const incoming = await bisi.agent.get('/api/v1/collaborations/requests?box=incoming');
    expect(incoming.body.items[0]).toMatchObject({ id: r.body.id, actions: ['accept', 'decline', 'clarify'] });

    const q = await post(bisi.agent, `/requests/${r.body.id}/clarify`, { question: 'What key is the beat in, and when do you record?' });
    expect(q.body).toMatchObject({
      status: 'CLARIFICATION_REQUESTED',
      clarificationQuestion: 'What key is the beat in, and when do you record?',
    });
    expect(await types(ade.userId)).toContain('collaboration.clarification');
    // The sender can't accept their own request; the recipient can't answer their own question.
    expect((await post(ade.agent, `/requests/${r.body.id}/accept`)).status).toBe(409);
    expect((await post(bisi.agent, `/requests/${r.body.id}/answer`, { answer: 'x y' })).status).toBe(409);

    const a = await post(ade.agent, `/requests/${r.body.id}/answer`, { answer: 'F minor, recording next Saturday.' });
    expect(a.body.status).toBe('PENDING');
    const acc = await post(bisi.agent, `/requests/${r.body.id}/accept`, { note: 'Let’s do it' });
    expect(acc.body).toMatchObject({ status: 'ACCEPTED', actions: [] });
    expect(acc.body.collaborationId).toBeTruthy();
    expect(await types(ade.userId)).toContain('collaboration.accepted');

    // The conversation carries a card per step, linked back to the request.
    const cards = await prisma.message.findMany({
      where: { conversationId: r.body.conversationId, kind: 'COLLABORATION' },
      orderBy: { createdAt: 'asc' },
    });
    expect(cards.map((m) => m.collaborationRequestId)).toEqual(Array(4).fill(r.body.id));

    const c = await ade.agent.get(`/api/v1/collaborations/${acc.body.collaborationId}`);
    expect(c.body).toMatchObject({
      status: 'ACTIVE',
      title: 'Afro-soul single',
      conversationId: r.body.conversationId,
      nextStatuses: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
    });
    expect(c.body.participants.map((p: { role: string }) => p.role).sort()).toEqual(['Hook vocals', 'Started the project']);
  });

  it('participants update status and close; closed is final; the other is notified', async () => {
    const ade = await signUp(app);
    const bisi = await signUp(app);
    const r = await post(ade.agent, '/requests', body(bisi.input.username));
    const id = (await post(bisi.agent, `/requests/${r.body.id}/accept`)).body.collaborationId;
    await post(ade.agent, `/${id}/notes`, { body: 'Sent the stems by email.' });
    expect((await post(bisi.agent, `/${id}/status`, { status: 'ON_HOLD', note: 'Travelling this week' })).body.status).toBe('ON_HOLD');
    expect(await types(ade.userId)).toContain('collaboration.status');
    const done = await post(ade.agent, `/${id}/status`, { status: 'COMPLETED', note: 'Released!' });
    expect(done.body).toMatchObject({ status: 'COMPLETED', nextStatuses: [] });
    expect(done.body.closedAt).toBeTruthy();
    expect((await post(bisi.agent, `/${id}/status`, { status: 'ACTIVE' })).status).toBe(409);
    expect((await post(bisi.agent, `/${id}/notes`, { body: 'one more' })).status).toBe(409);
  });

  it('one open request per pair (COL-004); decline and cancel are final; a new request after closing is fine', async () => {
    const ade = await signUp(app);
    const bisi = await signUp(app);
    const r = await post(ade.agent, '/requests', body(bisi.input.username));
    const dup = await post(ade.agent, '/requests', body(bisi.input.username, { title: 'Another idea' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('REQUEST_ALREADY_OPEN');
    expect((await post(bisi.agent, `/requests/${r.body.id}/decline`, { note: 'Fully booked this month' })).body.status).toBe('DECLINED');
    expect(await types(ade.userId)).toContain('collaboration.declined');
    expect((await post(bisi.agent, `/requests/${r.body.id}/accept`)).status).toBe(409);
    const again = await post(ade.agent, '/requests', body(bisi.input.username));
    expect(again.status).toBe(201);
    expect((await post(ade.agent, `/requests/${again.body.id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await post(ade.agent, `/requests/${again.body.id}/cancel`)).status).toBe(409);
  });

  it('privacy, blocks and validation', async () => {
    const ade = await signUp(app);
    const bisi = await signUp(app);
    const eve = await signUp(app);
    const r = await post(ade.agent, '/requests', body(bisi.input.username));
    expect((await eve.agent.get(`/api/v1/collaborations/requests/${r.body.id}`)).status).toBe(404);
    expect((await post(eve.agent, `/requests/${r.body.id}/accept`)).status).toBe(404);
    expect((await request(app).get('/api/v1/collaborations')).status).toBe(401);
    expect((await post(ade.agent, '/requests', body(ade.input.username))).status).toBe(400);
    expect((await post(ade.agent, '/requests', body(eve.input.username, { references: ['javascript:alert(1)'] }))).status).toBe(400);
    expect((await post(ade.agent, '/requests', body(eve.input.username, { deadline: '2020-01-01T00:00:00.000Z' }))).status).toBe(400);
    // Blocking cancels open requests and stops new ones.
    await bisi.agent.post('/api/v1/blocks').set('Origin', ORIGIN).send({ username: ade.input.username });
    expect((await prisma.collaborationRequest.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('CANCELLED');
    expect((await post(ade.agent, '/requests', body(bisi.input.username))).body.code).toBe('BLOCKED');
  });

  it('request cards don’t use up the first-message allowance in their conversation', async () => {
    const ade = await signUp(app);
    const bisi = await signUp(app);
    const r = await post(ade.agent, '/requests', body(bisi.input.username));
    const conv = await ade.agent.get(`/api/v1/conversations/${r.body.conversationId}`);
    expect(conv.body).toMatchObject({ canSend: true });
    expect(conv.body.sendLimitNote).toMatch(/3 more messages/);
  });
});
