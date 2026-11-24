import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);

describe('following (one-way, no approval)', () => {
  it('follow / unfollow are idempotent and counts come from real rows', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const path = `/api/v1/users/${bob.input.username}/follow`;

    expect((await alice.agent.put(path)).body).toEqual({ following: true, followers: 1 });
    expect((await alice.agent.put(path)).body).toEqual({ following: true, followers: 1 }); // no duplicate
    expect(await prisma.follow.count()).toBe(1);

    const profile = await request(app).get(`/api/v1/profiles/${bob.input.username}`);
    expect(profile.body.stats).toMatchObject({ followers: 1, following: 0, connections: 0 });

    const rel = await alice.agent.get(`/api/v1/users/${bob.input.username}/relationship`);
    expect(rel.body).toMatchObject({ following: true, followsYou: false, connection: null });

    expect((await alice.agent.delete(path)).body).toEqual({ following: false, followers: 0 });
    expect((await alice.agent.delete(path)).status).toBe(200);
  });

  it('following does not create a connection, and needs no acceptance', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    await alice.agent.put(`/api/v1/users/${bob.input.username}/follow`);
    expect(await prisma.connection.count()).toBe(0);
  });

  it("can't follow yourself, a missing user, or anyone while signed out", async () => {
    const alice = await signUp(app);
    expect((await alice.agent.put(`/api/v1/users/${alice.input.username}/follow`)).status).toBe(400);
    expect((await alice.agent.put('/api/v1/users/nobody_here/follow')).status).toBe(404);
    expect((await request(app).put(`/api/v1/users/${alice.input.username}/follow`)).status).toBe(401);
  });

  it('the database itself refuses a self-follow', async () => {
    const { userId } = await signUp(app);
    await expect(prisma.follow.create({ data: { followerId: userId, followingId: userId } })).rejects.toThrow();
  });

  it('lists followers and following', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    await alice.agent.put(`/api/v1/users/${bob.input.username}/follow`);
    const followers = await request(app).get(`/api/v1/users/${bob.input.username}/followers`);
    expect(followers.body.items.map((p: { username: string }) => p.username)).toEqual([alice.input.username]);
    const following = await request(app).get(`/api/v1/users/${alice.input.username}/following`);
    expect(following.body.items.map((p: { username: string }) => p.username)).toEqual([bob.input.username]);
  });
});

describe('connection requests', () => {
  async function pair() {
    return { alice: await signUp(app), bob: await signUp(app) };
  }

  it('request → accept → connected on both sides → remove', async () => {
    const { alice, bob } = await pair();
    const sent = await alice.agent.post('/api/v1/connections').send({ username: bob.input.username, message: 'Loved your last beat!' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'PENDING', direction: 'outgoing' });

    const incoming = await bob.agent.get('/api/v1/connections?filter=incoming');
    expect(incoming.body.items).toHaveLength(1);
    expect(incoming.body.items[0]).toMatchObject({ direction: 'incoming', message: 'Loved your last beat!' });
    expect((await alice.agent.get('/api/v1/connections?filter=outgoing')).body.items).toHaveLength(1);

    const accepted = await bob.agent.post(`/api/v1/connections/${sent.body.id}/accept`);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect((await alice.agent.get('/api/v1/connections')).body.items).toHaveLength(1);
    expect((await request(app).get(`/api/v1/profiles/${alice.input.username}`)).body.stats.connections).toBe(1);

    const rel = await alice.agent.get(`/api/v1/users/${bob.input.username}/relationship`);
    expect(rel.body.connection).toMatchObject({ status: 'ACCEPTED' });

    const removed = await alice.agent.delete(`/api/v1/connections/${sent.body.id}`);
    expect(removed.body.status).toBe('REMOVED');
    expect((await request(app).get(`/api/v1/profiles/${bob.input.username}`)).body.stats.connections).toBe(0);
  });

  it('prevents duplicate and crossed requests', async () => {
    const { alice, bob } = await pair();
    await alice.agent.post('/api/v1/connections').send({ username: bob.input.username });
    const again = await alice.agent.post('/api/v1/connections').send({ username: bob.input.username });
    expect(again.body.error.code).toBe('REQUEST_PENDING');
    const crossed = await bob.agent.post('/api/v1/connections').send({ username: alice.input.username });
    expect(crossed.body.error.code).toBe('REQUEST_RECEIVED');
    expect(await prisma.connection.count()).toBe(1);
  });

  it('the database rejects two live connections for one pair, even under a race', async () => {
    const { alice, bob } = await pair();
    const results = await Promise.all([
      alice.agent.post('/api/v1/connections').send({ username: bob.input.username }),
      bob.agent.post('/api/v1/connections').send({ username: alice.input.username }),
      alice.agent.post('/api/v1/connections').send({ username: bob.input.username }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.connection.count({ where: { status: { in: ['PENDING', 'ACCEPTED'] } } })).toBe(1);
  });

  it('only the right person can accept, decline, cancel or remove', async () => {
    const { alice, bob } = await pair();
    const carol = await signUp(app);
    const { id } = (await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).body;

    expect((await alice.agent.post(`/api/v1/connections/${id}/accept`)).status).toBe(409); // requester can't accept own
    expect((await carol.agent.post(`/api/v1/connections/${id}/accept`)).status).toBe(404); // stranger
    expect((await bob.agent.post(`/api/v1/connections/${id}/cancel`)).status).toBe(409); // only requester cancels
    expect((await carol.agent.delete(`/api/v1/connections/${id}`)).status).toBe(404);
    expect((await prisma.connection.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('a request can only be answered once', async () => {
    const { alice, bob } = await pair();
    const { id } = (await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).body;
    expect((await alice.agent.post(`/api/v1/connections/${id}/cancel`)).body.status).toBe('CANCELLED');
    const late = await bob.agent.post(`/api/v1/connections/${id}/accept`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('after a decline, the requester must wait 30 days; withdrawing has no cooldown', async () => {
    const { alice, bob } = await pair();
    const first = (await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).body;
    await alice.agent.post(`/api/v1/connections/${first.id}/cancel`);
    expect((await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).status).toBe(201);

    const pending = (await alice.agent.get('/api/v1/connections?filter=outgoing')).body.items[0];
    await bob.agent.post(`/api/v1/connections/${pending.id}/decline`);
    const blocked = await alice.agent.post('/api/v1/connections').send({ username: bob.input.username });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('CONNECTION_COOLDOWN');
    const rel = await alice.agent.get(`/api/v1/users/${bob.input.username}/relationship`);
    expect(rel.body.canRequestAfter).toBeTruthy();

    // The person who declined may still reach out themselves.
    expect((await bob.agent.post('/api/v1/connections').send({ username: alice.input.username })).status).toBe(201);
    await prisma.connection.deleteMany({ where: { requesterId: bob.userId } });

    // 31 days later the requester may ask again.
    await prisma.connection.updateMany({
      where: { status: 'DECLINED' },
      data: { respondedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    expect((await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).status).toBe(201);
  });

  it("can't connect with yourself or while signed out", async () => {
    const alice = await signUp(app);
    expect((await alice.agent.post('/api/v1/connections').send({ username: alice.input.username })).status).toBe(400);
    expect((await request(app).post('/api/v1/connections').send({ username: alice.input.username })).status).toBe(401);
  });

  it('suspended users drop out of connection lists and counts', async () => {
    const { alice, bob } = await pair();
    const { id } = (await alice.agent.post('/api/v1/connections').send({ username: bob.input.username })).body;
    await bob.agent.post(`/api/v1/connections/${id}/accept`);
    await prisma.user.update({ where: { id: bob.userId }, data: { status: 'SUSPENDED' } });
    expect((await alice.agent.get('/api/v1/connections')).body.items).toHaveLength(0);
    expect((await alice.agent.get('/api/v1/me')).body.profile.stats.connections).toBe(0);
  });
});
