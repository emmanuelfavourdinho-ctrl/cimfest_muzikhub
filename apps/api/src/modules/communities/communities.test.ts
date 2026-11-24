import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);
type Agent = ReturnType<typeof request.agent>;

const base = {
  name: 'Douala Producers Circle',
  description: 'Beatmakers and producers in Douala sharing techniques, sessions and feedback.',
  category: 'PRODUCTION',
  rules: 'Be kind. Credit samples. No spam or self-promotion outside Fridays.',
};
async function create(agent: Agent, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post('/api/v1/communities')
    .set('Origin', ORIGIN)
    .send({ ...base, policy: 'OPEN', ...overrides });
  expect(res.status).toBe(201);
  return res.body as { slug: string; id: string };
}
const post = (agent: Agent, path: string, body: object = {}) => agent.post(`/api/v1${path}`).set('Origin', ORIGIN).send(body);
const types = async (userId: string) => (await prisma.notification.findMany({ where: { userId } })).map((n) => n.type);

describe('discover and create', () => {
  it('creates a community with the creator as owner; validates; lists real data only', async () => {
    const owner = await signUp(app);
    expect((await post(owner.agent, '/communities', { ...base, policy: 'OPEN', name: 'x' })).status).toBe(400);
    const c = await create(owner.agent);
    expect(c.slug).toBe('douala-producers-circle');
    const detail = await request(app).get(`/api/v1/communities/${c.slug}`);
    expect(detail.body).toMatchObject({
      memberCount: 1,
      discussionCount: 0,
      policy: 'OPEN',
      canRead: true,
      owner: { username: owner.input.username },
    });
    const list = await request(app).get('/api/v1/communities?q=producers');
    expect(list.body.items.map((i: { slug: string }) => i.slug)).toEqual([c.slug]);
    expect((await request(app).get('/api/v1/communities?category=SONGWRITING')).body.items).toEqual([]);
    // A second community with the same name gets a unique slug.
    expect((await create(owner.agent)).slug).toMatch(/^douala-producers-circle-[0-9a-f]{6}$/);
  });

  it('caps how many communities one member can own', async () => {
    const owner = await signUp(app);
    for (let i = 0; i < 5; i += 1) await create(owner.agent, { name: `Circle number ${i}` });
    const sixth = await post(owner.agent, '/communities', { ...base, policy: 'OPEN', name: 'One too many' });
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe('TOO_MANY_COMMUNITIES');
  });
});

describe('membership', () => {
  it('open: join, post, reply; followers and mentions are notified; leave', async () => {
    const owner = await signUp(app);
    const member = await signUp(app);
    const c = await create(owner.agent);
    expect(
      (await post(member.agent, `/communities/${c.slug}/discussions`, { kind: 'QUESTION', title: 'Best 808s?', body: 'Which?' })).status,
    ).toBe(403);
    expect((await post(member.agent, `/communities/${c.slug}/join`)).body.membership).toEqual({ status: 'ACTIVE', role: 'MEMBER' });
    const d = await post(member.agent, `/communities/${c.slug}/discussions`, {
      kind: 'QUESTION',
      title: 'Best 808s for afrobeats?',
      body: 'What do you all use?',
    });
    expect(d.status).toBe(201);
    const reply = await post(owner.agent, `/discussions/${d.body.id}/comments`, {
      body: `Try layering a sine sub, @${member.input.username}`,
    });
    expect(reply.status).toBe(201);
    expect(await types(member.userId)).toEqual(expect.arrayContaining(['community.reply']));
    // The answer flow: the asker marks it, the replier hears about it.
    expect((await post(member.agent, `/discussions/${d.body.id}/answer`, { commentId: reply.body.id })).body.answered).toBe(true);
    expect(await types(owner.userId)).toContain('community.answer_accepted');
    await member.agent.put(`/api/v1/discussions/${d.body.id}/helpful`).set('Origin', ORIGIN);
    expect((await request(app).get(`/api/v1/discussions/${d.body.id}`)).body.helpfulCount).toBe(1);
    expect((await post(member.agent, `/communities/${c.slug}/leave`)).body.membership).toBeNull();
    expect((await post(owner.agent, `/communities/${c.slug}/leave`)).body.code).toBe('OWNER_CANNOT_LEAVE');
  });

  it('request to join: members-only reading, moderators notified, approval notifies and grants access', async () => {
    const owner = await signUp(app);
    const fan = await signUp(app);
    const c = await create(owner.agent, { policy: 'REQUEST' });
    await post(owner.agent, `/communities/${c.slug}/discussions`, {
      kind: 'DISCUSSION',
      title: 'Welcome thread',
      body: 'Introduce yourself',
    });
    expect((await fan.agent.get(`/api/v1/communities/${c.slug}/discussions`)).status).toBe(403);
    expect((await fan.agent.get(`/api/v1/communities/${c.slug}`)).body.canRead).toBe(false);
    expect((await post(fan.agent, `/communities/${c.slug}/join`, { note: 'I produce amapiano' })).body.membership).toEqual({
      status: 'PENDING',
      role: 'MEMBER',
    });
    expect(await types(owner.userId)).toContain('community.join_request');
    const pending = await owner.agent.get(`/api/v1/communities/${c.slug}/members?status=PENDING`);
    expect(pending.body.items[0]).toMatchObject({ username: fan.input.username, requestNote: 'I produce amapiano' });
    expect((await fan.agent.get(`/api/v1/communities/${c.slug}/members?status=PENDING`)).status).toBe(403);
    await post(owner.agent, `/communities/${c.slug}/members/${fan.input.username}/approve`);
    expect(await types(fan.userId)).toContain('community.request_approved');
    expect((await fan.agent.get(`/api/v1/communities/${c.slug}/discussions`)).body.items).toHaveLength(1);
  });

  it('invitation only: no self-join; invite → accept; blocked people can’t be invited', async () => {
    const owner = await signUp(app);
    const guest = await signUp(app);
    const blocked = await signUp(app);
    const c = await create(owner.agent, { policy: 'INVITE' });
    expect((await post(guest.agent, `/communities/${c.slug}/join`)).body.code).toBe('INVITE_ONLY');
    expect((await post(owner.agent, `/communities/${c.slug}/invitations`, { username: guest.input.username })).status).toBe(201);
    expect(await types(guest.userId)).toContain('community.invitation');
    expect((await post(guest.agent, `/communities/${c.slug}/invitation/accept`)).body.membership.status).toBe('ACTIVE');
    await post(blocked.agent, '/blocks', { username: owner.input.username });
    expect((await post(owner.agent, `/communities/${c.slug}/invitations`, { username: blocked.input.username })).body.code).toBe('BLOCKED');
  });
});

describe('roles and community moderation (scoped to the community)', () => {
  async function setup() {
    const owner = await signUp(app);
    const mod = await signUp(app);
    const member = await signUp(app);
    const c = await create(owner.agent);
    await post(mod.agent, `/communities/${c.slug}/join`);
    await post(member.agent, `/communities/${c.slug}/join`);
    await owner.agent
      .put(`/api/v1/communities/${c.slug}/members/${mod.input.username}/role`)
      .set('Origin', ORIGIN)
      .send({ role: 'MODERATOR' });
    return { owner, mod, member, c };
  }

  it('moderators remove content (reason, audit, author told), pin and lock; members can’t', async () => {
    const { mod, member, c } = await setup();
    const d = await post(member.agent, `/communities/${c.slug}/discussions`, {
      kind: 'DISCUSSION',
      title: 'Buy my beats cheap',
      body: 'link in bio',
    });
    expect((await post(member.agent, `/discussions/${d.body.id}/remove`, { reason: 'Trying it' })).status).toBe(403);
    await post(mod.agent, `/discussions/${d.body.id}/lock`);
    expect((await post(member.agent, `/discussions/${d.body.id}/comments`, { body: 'hello' })).body.code).toBe('LOCKED');
    expect((await post(mod.agent, `/discussions/${d.body.id}/remove`, { reason: 'Spam is not allowed here' })).status).toBe(200);
    expect((await request(app).get(`/api/v1/discussions/${d.body.id}`)).status).toBe(404);
    expect(await types(member.userId)).toContain('community.content_removed');
    expect(await prisma.auditLog.count({ where: { action: 'community.discussion.remove', actorRole: 'community:MODERATOR' } })).toBe(1);
  });

  it('role rules: moderators can’t grant roles; admins can’t make admins; nobody acts on an equal role', async () => {
    const { owner, mod, member, c } = await setup();
    const role = (agent: Agent, who: string, r: string) =>
      agent.put(`/api/v1/communities/${c.slug}/members/${who}/role`).set('Origin', ORIGIN).send({ role: r });
    expect((await role(mod.agent, member.input.username, 'MODERATOR')).status).toBe(403);
    await role(owner.agent, member.input.username, 'ADMIN');
    expect((await role(member.agent, mod.input.username, 'ADMIN')).status).toBe(403);
    expect((await post(mod.agent, `/communities/${c.slug}/members/${owner.input.username}/ban`)).status).toBe(403);
    // A ban removes them and keeps them out.
    await role(owner.agent, member.input.username, 'MEMBER');
    expect(
      (await post(mod.agent, `/communities/${c.slug}/members/${member.input.username}/ban`, { reason: 'Repeated spam' })).body.status,
    ).toBe('BANNED');
    expect((await post(member.agent, `/communities/${c.slug}/join`)).body.code).toBe('BANNED');
    // Community roles never grant platform powers.
    expect((await mod.agent.get('/api/v1/admin/reports')).status).toBe(403);
  });

  it('ownership can be handed over; the old owner becomes an admin and may then leave', async () => {
    const { owner, mod, c } = await setup();
    await post(owner.agent, `/communities/${c.slug}/members/${mod.input.username}/owner`);
    const detail = await request(app).get(`/api/v1/communities/${c.slug}`);
    expect(detail.body.owner.username).toBe(mod.input.username);
    expect((await post(owner.agent, `/communities/${c.slug}/leave`)).status).toBe(200);
  });
});

describe('platform moderation, reports and preferences', () => {
  it('a discussion can be reported and removed by platform staff through the usual queue', async () => {
    const owner = await signUp(app);
    const reporter = await signUp(app);
    const c = await create(owner.agent);
    await post(reporter.agent, `/communities/${c.slug}/join`);
    const d = await post(owner.agent, `/communities/${c.slug}/discussions`, { kind: 'DISCUSSION', title: 'Offensive thread', body: 'bad' });
    expect((await post(reporter.agent, '/reports', { targetType: 'DISCUSSION', targetId: d.body.id, reason: 'HARASSMENT' })).status).toBe(
      201,
    );
    const staff = await makeStaff(app, 'MODERATOR');
    const queue = await staff.agent.get('/api/v1/admin/reports?open=true');
    expect(queue.body.items[0].target).toMatchObject({
      exists: true,
      moderationType: 'discussion',
      link: `/communities/${c.slug}/d/${d.body.id}`,
    });
    expect((await post(staff.agent, `/admin/content/discussion/${d.body.id}/remove`, { reason: 'Harassment is not allowed' })).status).toBe(
      200,
    );
    expect((await request(app).get(`/api/v1/discussions/${d.body.id}`)).status).toBe(404);
  });

  it('members-only content can’t be reported (or probed) by outsiders', async () => {
    const owner = await signUp(app);
    const outsider = await signUp(app);
    const c = await create(owner.agent, { policy: 'REQUEST' });
    const d = await post(owner.agent, `/communities/${c.slug}/discussions`, { kind: 'DISCUSSION', title: 'Private plans', body: 'secret' });
    expect((await post(outsider.agent, '/reports', { targetType: 'DISCUSSION', targetId: d.body.id, reason: 'SPAM' })).status).toBe(404);
  });

  it('turning off community notifications stops reply notices', async () => {
    const owner = await signUp(app);
    const member = await signUp(app);
    const c = await create(owner.agent);
    await post(member.agent, `/communities/${c.slug}/join`);
    const d = await post(owner.agent, `/communities/${c.slug}/discussions`, {
      kind: 'GUIDE',
      title: 'How I mix vocals',
      body: 'Step one…',
    });
    await owner.agent
      .put('/api/v1/notifications/settings')
      .set('Origin', ORIGIN)
      .send({ settings: [{ category: 'COMMUNITIES', inApp: false }] });
    await post(member.agent, `/discussions/${d.body.id}/comments`, { body: 'Thank you!' });
    expect(await types(owner.userId)).not.toContain('community.reply');
  });
});
