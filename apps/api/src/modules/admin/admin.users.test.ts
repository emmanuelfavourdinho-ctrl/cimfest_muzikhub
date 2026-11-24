import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { reinstateExpiredSuspensions } from '../../lib/account-status.js';
import { prisma } from '../../lib/prisma.js';
import { ageSessions, makeStaff, ORIGIN, resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function setStatus(agent: ReturnType<typeof request.agent>, userId: string, body: object) {
  return agent.post(`/api/v1/admin/users/${userId}/status`).send(body);
}

describe('RESTRICTED: can sign in and browse, cannot publish or interact', () => {
  it('is enforced on the server for every interactive action', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const target = await signUp(app);
    const other = await signUp(app);
    const otherPost = await other.agent.post('/api/v1/posts').send({ body: 'hello' });
    const ownPost = await target.agent.post('/api/v1/posts').send({ body: 'mine' });
    const pendingFromOther = await other.agent.post('/api/v1/connections').send({ username: target.input.username });

    expect((await setStatus(mod.agent, target.userId, { status: 'RESTRICTED', reason: 'Spam behaviour' })).status).toBe(200);

    // Still signed in and browsing.
    const me = await target.agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ accountStatus: 'RESTRICTED', statusReason: 'Spam behaviour' });
    expect((await target.agent.get('/api/v1/feed')).status).toBe(200);
    expect((await target.agent.get(`/api/v1/profiles/${other.input.username}`)).status).toBe(200);
    // Still visible to others.
    expect((await request(app).get(`/api/v1/profiles/${target.input.username}`)).status).toBe(200);

    const blocked: [string, Promise<request.Response>][] = [
      ['post', target.agent.post('/api/v1/posts').send({ body: 'new' })],
      ['edit post', target.agent.patch(`/api/v1/posts/${ownPost.body.id}`).send({ body: 'edit' })],
      ['comment', target.agent.post(`/api/v1/posts/${otherPost.body.id}/comments`).send({ body: 'hi' })],
      ['like', target.agent.put(`/api/v1/posts/${otherPost.body.id}/like`)],
      ['follow', target.agent.put(`/api/v1/users/${other.input.username}/follow`)],
      ['connect', target.agent.post('/api/v1/connections').send({ username: other.input.username })],
      ['accept', target.agent.post(`/api/v1/connections/${pendingFromOther.body.id}/accept`)],
      ['portfolio', target.agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'x', description: 'd' })],
      ['upload', target.agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 10 })],
      ['profile edit', target.agent.patch('/api/v1/me/profile').send({ bio: 'new bio' })],
    ];
    for (const [label, pending] of blocked) {
      const res = await pending;
      expect(res.status, label).toBe(403);
      expect(res.body.error.code, label).toBe('ACCOUNT_RESTRICTED');
    }
    // Reducing actions remain possible: delete own post, decline, report.
    expect((await target.agent.delete(`/api/v1/posts/${ownPost.body.id}`)).status).toBe(204);
    expect((await target.agent.post(`/api/v1/connections/${pendingFromOther.body.id}/decline`)).status).toBe(200);
    expect(
      (await target.agent.post('/api/v1/reports').send({ targetType: 'POST', targetId: otherPost.body.id, reason: 'SPAM' })).status,
    ).toBe(201);
  });
});

describe('SUSPENDED: temporary, mandatory reason and expiry, sessions revoked', () => {
  it('requires a reason and a future end date', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const t = await signUp(app);
    expect((await setStatus(mod.agent, t.userId, { status: 'SUSPENDED', reason: 'Harassment' })).status).toBe(400);
    expect((await setStatus(mod.agent, t.userId, { status: 'SUSPENDED', reason: 'no', until: days(3) })).status).toBe(400);
    expect((await setStatus(mod.agent, t.userId, { status: 'SUSPENDED', reason: 'Harassment', until: days(-1) })).status).toBe(400);
  });

  it('ends existing sessions immediately, blocks sign-in, hides the profile, then reinstates after expiry', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const t = await signUp(app);
    const res = await setStatus(mod.agent, t.userId, { status: 'SUSPENDED', reason: 'Harassment', until: days(3) });
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(1);

    expect((await t.agent.get('/api/v1/me')).status).toBe(401); // session gone
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: t.input.email, password: t.input.password });
    expect(signIn.status).toBe(403);
    expect((await request(app).get(`/api/v1/profiles/${t.input.username}`)).status).toBe(404);

    // The end date passes → automatically reinstated (audited) at next sign-in.
    await prisma.user.update({ where: { id: t.userId }, data: { statusUntil: new Date(Date.now() - 1000) } });
    const again = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: t.input.email, password: t.input.password });
    expect(again.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).status).toBe('ACTIVE');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.status.expired', targetId: t.userId } });
    expect(audit.actorLabel).toBe('system:suspension-expiry');
  });

  it('the background sweep reinstates expired suspensions too', async () => {
    const t = await signUp(app);
    await prisma.user.update({
      where: { id: t.userId },
      data: { status: 'SUSPENDED', statusReason: 'x', statusUntil: new Date(Date.now() - 1000) },
    });
    expect(await reinstateExpiredSuspensions()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).status).toBe('ACTIVE');
  });
});

describe('BANNED: indefinite; only an administrator can reinstate', () => {
  it('admin bans (fresh session), sessions revoked; moderators cannot reinstate; admin can', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const mod = await makeStaff(app, 'MODERATOR');
    const t = await signUp(app);

    expect((await setStatus(admin.agent, t.userId, { status: 'BANNED', reason: 'Fraudulent account' })).status).toBe(200);
    expect((await t.agent.get('/api/v1/me')).status).toBe(401);
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: t.input.email, password: t.input.password });
    expect(signIn.status).toBe(403);

    expect((await setStatus(mod.agent, t.userId, { status: 'ACTIVE', reason: 'Appeal accepted' })).status).toBe(403);
    expect((await setStatus(admin.agent, t.userId, { status: 'RESTRICTED', reason: 'Downgrade it' })).body.error.code).toBe('BANNED');
    await ageSessions(admin.userId);
    expect((await setStatus(admin.agent, t.userId, { status: 'ACTIVE', reason: 'Appeal accepted' })).body.error.code).toBe(
      'REAUTH_REQUIRED',
    );
    await prisma.session.updateMany({ where: { userId: admin.userId }, data: { createdAt: new Date() } });
    expect((await setStatus(admin.agent, t.userId, { status: 'ACTIVE', reason: 'Appeal accepted' })).status).toBe(200);
    expect(
      (await request(app).post('/api/auth/sign-in/email').set('Origin', ORIGIN).send({ email: t.input.email, password: t.input.password }))
        .status,
    ).toBe(200);
  });

  it('banned and suspended accounts vanish from discovery and the feed', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const t = await signUp(app, { username: 'soon.banned' });
    await t.agent.post('/api/v1/posts').send({ body: 'before ban' });
    await setStatus(admin.agent, t.userId, { status: 'BANNED', reason: 'Fraudulent account' });
    expect((await request(app).get('/api/v1/feed')).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/discover/people?q=soon.banned')).body.items).toHaveLength(0);
  });
});

describe('user management views', () => {
  it('lists and filters users by status, platform role and professional role, and shows real activity', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const producer = await signUp(app);
    await producer.agent.patch('/api/v1/me/profile').send({ roles: ['PRODUCER'] });
    const img = await uploadMedia(producer.agent, { purpose: 'POST' });
    await producer.agent.post('/api/v1/posts').send({ body: 'beat drop', mediaIds: [img] });
    const quiet = await signUp(app);
    await prisma.user.update({ where: { id: quiet.userId }, data: { status: 'RESTRICTED' } });

    const byRole = await admin.agent.get('/api/v1/admin/users?creativeRole=PRODUCER');
    expect(byRole.body.items.map((u: { id: string }) => u.id)).toEqual([producer.userId]);
    const byStatus = await admin.agent.get('/api/v1/admin/users?status=RESTRICTED');
    expect(byStatus.body.items.map((u: { id: string }) => u.id)).toEqual([quiet.userId]);
    const staff = await admin.agent.get('/api/v1/admin/users?role=ADMIN');
    expect(staff.body.items.map((u: { id: string }) => u.id)).toEqual([admin.userId]);

    const detail = await admin.agent.get(`/api/v1/admin/users/${producer.userId}`);
    expect(detail.body.activity).toMatchObject({ posts: 1, comments: 0, portfolioItems: 0 });
    expect(detail.body.lastActiveAt).toBeTruthy();
    expect(detail.body.allowed).toMatchObject({ ban: true, changeRole: true, maxSuspensionDays: 365 });
  });

  it('reset two-factor: an admin recovers a staff member who lost their authenticator', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const mod = await makeStaff(app, 'MODERATOR');
    const res = await admin.agent.post(`/api/v1/admin/users/${mod.userId}/reset-two-factor`).send({ reason: 'Lost their phone' });
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mod.userId } })).twoFactorEnabled).toBe(false);
    expect(await prisma.twoFactor.count({ where: { userId: mod.userId } })).toBe(0);
    expect((await mod.agent.get('/api/v1/admin/overview')).status).toBe(401); // signed out everywhere
  });
});
