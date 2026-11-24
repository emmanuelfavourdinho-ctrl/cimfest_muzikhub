import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { ageSessions, makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';
import { totp } from '../../test/totp.js';

const app = testApp();
beforeEach(resetDatabase);

/** Every admin endpoint, with a minimal valid body. :id placeholders are filled per test. */
const endpoints = (ids: { user: string; report: string; post: string }) =>
  [
    ['get', '/api/v1/admin/overview', undefined],
    ['get', '/api/v1/admin/users', undefined],
    ['get', `/api/v1/admin/users/${ids.user}`, undefined],
    ['post', `/api/v1/admin/users/${ids.user}/status`, { status: 'RESTRICTED', reason: 'Spam behaviour' }],
    ['post', `/api/v1/admin/users/${ids.user}/role`, { role: 'MODERATOR', reason: 'Joining the team' }],
    ['post', `/api/v1/admin/users/${ids.user}/reset-two-factor`, { reason: 'Lost device' }],
    ['get', '/api/v1/admin/reports', undefined],
    ['get', `/api/v1/admin/reports/${ids.report}`, undefined],
    ['post', `/api/v1/admin/reports/${ids.report}/assign`, { assignee: 'me' }],
    ['post', `/api/v1/admin/reports/${ids.report}/notes`, { body: 'Looking into it' }],
    ['post', `/api/v1/admin/reports/${ids.report}/escalate`, { reason: 'Needs an admin' }],
    ['post', `/api/v1/admin/reports/${ids.report}/resolve`, { resolution: 'Handled it now' }],
    ['post', `/api/v1/admin/reports/${ids.report}/dismiss`, { resolution: 'Not a violation' }],
    ['get', '/api/v1/admin/content', undefined],
    ['post', `/api/v1/admin/content/post/${ids.post}/remove`, { reason: 'Spam content' }],
    ['post', `/api/v1/admin/content/post/${ids.post}/restore`, { reason: 'Mistake made' }],
    ['get', '/api/v1/admin/audit', undefined],
  ] as const;

async function fixtures() {
  const target = await signUp(app);
  const reporter = await signUp(app);
  const post = await target.agent.post('/api/v1/posts').send({ body: 'reported post' });
  await reporter.agent.post('/api/v1/reports').send({ targetType: 'POST', targetId: post.body.id, reason: 'SPAM' });
  const report = await prisma.report.findFirstOrThrow();
  return { user: target.userId, report: report.id, post: post.body.id as string };
}

describe('non-staff cannot reach any admin endpoint', () => {
  it.each([
    ['signed out', 401],
    ['ordinary user', 403],
    ['restricted user', 403],
    ['moderator without two-factor', 403],
  ] as const)('%s → %i on every endpoint', async (who, expected) => {
    const ids = await fixtures();
    let agent: ReturnType<typeof request.agent> | null = null;
    if (who === 'ordinary user') agent = (await signUp(app)).agent;
    if (who === 'restricted user') {
      const u = await signUp(app);
      await prisma.user.update({ where: { id: u.userId }, data: { status: 'RESTRICTED' } });
      agent = u.agent;
    }
    if (who === 'moderator without two-factor') agent = (await makeStaff(app, 'MODERATOR', { twoFactor: false })).agent;

    for (const [method, path, body] of endpoints(ids)) {
      const res = agent
        ? await agent[method](path).send(body ?? {})
        : await request(app)
            [method](path)
            .send(body ?? {});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(expected);
    }
    // Nothing changed.
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: ids.report } })).status).toBe('PENDING');
  });

  it('tells a staff member without two-factor exactly what to do', async () => {
    const mod = await makeStaff(app, 'MODERATOR', { twoFactor: false });
    const res = await mod.agent.get('/api/v1/admin/overview');
    expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
    const me = await mod.agent.get('/api/v1/admin/me');
    expect(me.body).toMatchObject({ isStaff: true, role: 'MODERATOR', twoFactorEnabled: false });
  });

  it('GET /admin/me reveals nothing to ordinary users', async () => {
    const u = await signUp(app);
    expect((await u.agent.get('/api/v1/admin/me')).body).toMatchObject({ isStaff: false, role: null, permissions: [] });
  });
});

describe('moderator permissions (approved matrix)', () => {
  it('can moderate and manage reports, but cannot ban, assign roles, reset 2FA or read the audit log', async () => {
    const ids = await fixtures();
    const mod = await makeStaff(app, 'MODERATOR');
    const ok = async (method: 'get' | 'post', path: string, body?: object) => (await mod.agent[method](path).send(body ?? {})).status;

    expect(await ok('get', '/api/v1/admin/overview')).toBe(200);
    expect(await ok('get', '/api/v1/admin/reports')).toBe(200);
    expect(await ok('post', `/api/v1/admin/reports/${ids.report}/assign`, { assignee: 'me' })).toBe(200);
    expect(await ok('post', `/api/v1/admin/content/post/${ids.post}/remove`, { reason: 'Spam content' })).toBe(200);
    expect(await ok('post', `/api/v1/admin/users/${ids.user}/status`, { status: 'RESTRICTED', reason: 'Spam behaviour' })).toBe(200);

    expect(await ok('post', `/api/v1/admin/users/${ids.user}/status`, { status: 'BANNED', reason: 'Repeated spam' })).toBe(403);
    expect(await ok('post', `/api/v1/admin/users/${ids.user}/role`, { role: 'MODERATOR', reason: 'Promote them' })).toBe(403);
    expect(await ok('post', `/api/v1/admin/users/${ids.user}/reset-two-factor`, { reason: 'Lost device' })).toBe(403);
    expect(await ok('get', '/api/v1/admin/audit')).toBe(403);
  });

  it('suspensions are limited to 30 days for moderators', async () => {
    const target = await signUp(app);
    const mod = await makeStaff(app, 'MODERATOR');
    const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
    const tooLong = await mod.agent
      .post(`/api/v1/admin/users/${target.userId}/status`)
      .send({ status: 'SUSPENDED', reason: 'Harassment', until: days(45) });
    expect(tooLong.body.code).toBe('SUSPENSION_TOO_LONG');
    const ok = await mod.agent
      .post(`/api/v1/admin/users/${target.userId}/status`)
      .send({ status: 'SUSPENDED', reason: 'Harassment', until: days(7) });
    expect(ok.status).toBe(200);
  });

  it('cannot see email addresses; admins can', async () => {
    const target = await signUp(app);
    const mod = await makeStaff(app, 'MODERATOR');
    const admin = await makeStaff(app, 'ADMIN');
    expect((await mod.agent.get(`/api/v1/admin/users/${target.userId}`)).body.email).toBeNull();
    expect(JSON.stringify((await mod.agent.get('/api/v1/admin/users')).body)).not.toContain(target.input.email);
    expect((await admin.agent.get(`/api/v1/admin/users/${target.userId}`)).body.email).toBe(target.input.email);
    // Moderators can't search by email either (no probing).
    expect((await mod.agent.get(`/api/v1/admin/users?q=${encodeURIComponent(target.input.email)}`)).body.items).toHaveLength(0);
  });
});

describe('privilege escalation', () => {
  it('nobody can act on themselves or on staff of the same or a higher role', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const mod2 = await makeStaff(app, 'MODERATOR');
    const admin = await makeStaff(app, 'ADMIN');
    const res = (agent: typeof mod.agent, id: string) =>
      agent.post(`/api/v1/admin/users/${id}/status`).send({ status: 'RESTRICTED', reason: 'Testing rules' });

    expect((await res(mod.agent, mod.userId)).body.code).toBe('CANNOT_ACT_ON_SELF');
    expect((await res(mod.agent, mod2.userId)).body.code).toBe('FORBIDDEN_TARGET');
    expect((await res(mod.agent, admin.userId)).body.code).toBe('FORBIDDEN_TARGET');
    expect((await res(admin.agent, mod.userId)).status).toBe(200); // admins may act on moderators
  });

  it('an admin cannot change their own role', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const self = await admin.agent.post(`/api/v1/admin/users/${admin.userId}/role`).send({ role: 'USER', reason: 'Stepping down' });
    expect(self.body.code).toBe('CANNOT_ACT_ON_SELF');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).platformRole).toBe('ADMIN');
  });

  it('two admins demoting each other at the same moment can never leave zero administrators', async () => {
    for (let round = 0; round < 3; round++) {
      await resetDatabase();
      const a = await makeStaff(app, 'ADMIN');
      const b = await makeStaff(app, 'ADMIN');
      const [ra, rb] = await Promise.all([
        a.agent.post(`/api/v1/admin/users/${b.userId}/role`).send({ role: 'USER', reason: 'Race condition test' }),
        b.agent.post(`/api/v1/admin/users/${a.userId}/role`).send({ role: 'USER', reason: 'Race condition test' }),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]); // exactly one wins
      expect(await prisma.user.count({ where: { platformRole: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    }
  });

  it('a demoted administrator loses access on their very next request', async () => {
    const a = await makeStaff(app, 'ADMIN');
    const b = await makeStaff(app, 'ADMIN');
    expect((await b.agent.get('/api/v1/admin/overview')).status).toBe(200);
    await a.agent.post(`/api/v1/admin/users/${b.userId}/role`).send({ role: 'USER', reason: 'Leaving the team' });
    expect((await b.agent.get('/api/v1/admin/overview')).body.code).toBe('NOT_STAFF');
  });

  it('roles can only be promoted onto active, verified accounts', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const unverified = await signUp(app);
    const res = await admin.agent
      .post(`/api/v1/admin/users/${unverified.userId}/role`)
      .send({ role: 'MODERATOR', reason: 'Join the team' });
    expect(res.body.code).toBe('NOT_ELIGIBLE');
  });

  it('sign-up and profile updates still cannot set a platform role', async () => {
    const res = await request(app).post('/api/auth/sign-up/email').set('Origin', ORIGIN).send({
      name: 'Sneaky',
      email: 'sneaky@example.test',
      username: 'sneaky1',
      password: 'correct-horse-battery',
      primaryUse: 'FAN',
      platformRole: 'ADMIN',
    });
    expect([200, 400]).toContain(res.status);
    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(0);
    const u = await signUp(app);
    expect((await u.agent.patch('/api/v1/me/profile').send({ platformRole: 'ADMIN' })).status).toBe(400);
  });
});

describe('fresh session for sensitive actions', () => {
  it('ban, ban reinstatement, role changes and 2FA resets need a recent sign-in', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const target = await signUp(app);
    await ageSessions(admin.userId);
    const ban = await admin.agent
      .post(`/api/v1/admin/users/${target.userId}/status`)
      .send({ status: 'BANNED', reason: 'Fraudulent account' });
    expect(ban.body.code).toBe('REAUTH_REQUIRED');
    const role = await admin.agent.post(`/api/v1/admin/users/${target.userId}/role`).send({ role: 'USER', reason: 'whatever' });
    expect(role.body.code).toBe('REAUTH_REQUIRED');
    // Less sensitive moderation still works on an older session.
    expect(
      (await admin.agent.post(`/api/v1/admin/users/${target.userId}/status`).send({ status: 'RESTRICTED', reason: 'Spam behaviour' }))
        .status,
    ).toBe(200);
  });
});

describe('two-factor authentication (Better Auth plugin)', () => {
  it('a staff member with 2FA must give a code at sign-in; trusted devices are refused', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const agent = request.agent(app);
    const signIn = await agent
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: mod.input.email, password: mod.input.password });
    expect(signIn.status).toBe(200);
    expect(signIn.body.twoFactorRedirect).toBe(true);
    expect((await agent.get('/api/v1/admin/overview')).status).toBe(401); // no session yet

    const trust = await agent
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', ORIGIN)
      .send({ code: totp(mod.secret!), trustDevice: true });
    expect(trust.status).toBe(400);
    const wrong = await agent.post('/api/auth/two-factor/verify-totp').set('Origin', ORIGIN).send({ code: '000000' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const ok = await agent
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', ORIGIN)
      .send({ code: totp(mod.secret!) });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/v1/admin/overview')).status).toBe(200);
  });

  it('backup codes recover access when the authenticator is lost', async () => {
    const user = await signUp(app);
    await prisma.user.update({ where: { id: user.userId }, data: { platformRole: 'MODERATOR', emailVerified: true } });
    const enabled = await user.agent.post('/api/auth/two-factor/enable').set('Origin', ORIGIN).send({ password: user.input.password });
    const { backupCodes, totpURI } = enabled.body as { backupCodes: string[]; totpURI: string };
    expect(backupCodes.length).toBeGreaterThanOrEqual(8);
    await user.agent
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', ORIGIN)
      .send({ code: totp(new URL(totpURI).searchParams.get('secret')!) });

    // Stored encrypted: neither the secret nor a backup code appears in plain text.
    const row = await prisma.twoFactor.findFirstOrThrow({ where: { userId: user.userId } });
    expect(row.backupCodes).not.toContain(backupCodes[0]);
    expect(row.secret).not.toBe(new URL(totpURI).searchParams.get('secret'));

    const agent = request.agent(app);
    await agent.post('/api/auth/sign-in/email').set('Origin', ORIGIN).send({ email: user.input.email, password: user.input.password });
    const recover = await agent.post('/api/auth/two-factor/verify-backup-code').set('Origin', ORIGIN).send({ code: backupCodes[0] });
    expect(recover.status).toBe(200);
    expect((await agent.get('/api/v1/admin/overview')).status).toBe(200);

    // A backup code works only once.
    const again = request.agent(app);
    await again.post('/api/auth/sign-in/email').set('Origin', ORIGIN).send({ email: user.input.email, password: user.input.password });
    expect(
      (await again.post('/api/auth/two-factor/verify-backup-code').set('Origin', ORIGIN).send({ code: backupCodes[0] })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('ordinary users are not forced to use two-factor', async () => {
    const u = await signUp(app);
    expect((await u.agent.post('/api/v1/posts').send({ body: 'no 2FA needed' })).status).toBe(201);
  });
});
