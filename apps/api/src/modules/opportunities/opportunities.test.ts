import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const draft = (over: Record<string, unknown> = {}) => ({
  type: 'GIG',
  title: 'Saturday live set at the harbour',
  description: 'Looking for a DJ for a two-hour open-air set, all equipment provided on site.',
  location: 'Douala',
  deadline: inDays(10),
  ...over,
});

async function organiser() {
  const u = await signUp(app, { primaryUse: 'PROFESSIONAL' });
  await prisma.user.update({ where: { id: u.userId }, data: { emailVerified: true, isOrganiser: true } });
  return u;
}
async function published(org: Awaited<ReturnType<typeof organiser>>, over = {}) {
  const o = (await org.agent.post('/api/v1/opportunities').send(draft(over))).body;
  expect((await org.agent.post(`/api/v1/opportunities/${o.id}/publish`)).status).toBe(200);
  return o as { id: string };
}

describe('opportunities (FR-34..37)', () => {
  beforeEach(resetDatabase);

  it('organiser creates a draft (hidden from others), publishes it, it appears in browse and details', async () => {
    const org = await organiser();
    const res = await org.agent.post('/api/v1/opportunities').send(draft());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', isOwner: true, acceptingApplications: false });
    const viewer = await signUp(app);
    expect((await viewer.agent.get(`/api/v1/opportunities/${res.body.id}`)).status).toBe(404); // drafts are private
    expect((await request(app).get('/api/v1/opportunities')).body.items).toHaveLength(0);
    await org.agent.post(`/api/v1/opportunities/${res.body.id}/publish`);
    const list = await request(app).get('/api/v1/opportunities').query({ type: 'GIG', location: 'doua' });
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([res.body.id]);
    expect((await request(app).get('/api/v1/opportunities').query({ type: 'JOB' })).body.items).toHaveLength(0);
    const detail = await viewer.agent.get(`/api/v1/opportunities/${res.body.id}`);
    expect(detail.body).toMatchObject({
      status: 'PUBLISHED',
      acceptingApplications: true,
      isOwner: false,
      applicationCount: null,
      myApplication: null,
    });
  });

  it('only approved organisers (admin approval + verified email + professional) can create', async () => {
    const member = await signUp(app);
    const r1 = await member.agent.post('/api/v1/opportunities').send(draft());
    expect(r1.status).toBe(403);
    expect(r1.body.code).toBe('NOT_AN_ORGANISER');
    expect((await member.agent.get('/api/v1/opportunities/organiser-status')).body).toEqual({
      canOrganise: false,
      missing: ['ADMIN_APPROVAL', 'VERIFIED_EMAIL', 'PROFESSIONAL_ACCOUNT'],
    });
    // Approved but not a professional account → still refused.
    await prisma.user.update({ where: { id: member.userId }, data: { isOrganiser: true, emailVerified: true } });
    expect((await member.agent.post('/api/v1/opportunities').send(draft())).body.code).toBe('NOT_AN_ORGANISER');
    expect((await request(app).post('/api/v1/opportunities').send(draft())).status).toBe(401);
  });

  it('rejects unknown fields and invalid input (strict schemas)', async () => {
    const org = await organiser();
    const res = await org.agent.post('/api/v1/opportunities').send({ ...draft(), status: 'PUBLISHED', organiserId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await org.agent.post('/api/v1/opportunities').send(draft({ type: 'PARTY' }))).status).toBe(400);
  });

  it('publishing needs a future deadline; other people cannot edit, publish or close', async () => {
    const org = await organiser();
    const past = (await org.agent.post('/api/v1/opportunities').send(draft({ deadline: inDays(-1) }))).body;
    expect((await org.agent.post(`/api/v1/opportunities/${past.id}/publish`)).body.code).toBe('DEADLINE_IN_PAST');
    const o = await published(org);
    const other = await organiser();
    expect((await other.agent.patch(`/api/v1/opportunities/${o.id}`).send({ title: 'Hijacked title here' })).status).toBe(403);
    expect((await other.agent.post(`/api/v1/opportunities/${o.id}/close`)).status).toBe(403);
    expect((await other.agent.post(`/api/v1/opportunities/${past.id}/publish`)).status).toBe(404); // someone else's draft
  });

  it('apply once, withdraw, re-apply; no applying to own, closed or past-deadline opportunities', async () => {
    const org = await organiser();
    const o = await published(org);
    const fan = await signUp(app);
    const applied = await fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'I play sets every weekend.' });
    expect(applied.status).toBe(201);
    expect(applied.body.myApplication).toMatchObject({ status: 'SUBMITTED' });
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'again' })).body.code).toBe('ALREADY_APPLIED');
    expect((await org.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'me' })).body.code).toBe('CANNOT_APPLY_OWN');
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/withdraw`)).body.myApplication.status).toBe('WITHDRAWN');
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'Back in.' })).status).toBe(201);
    // Deadline passes → applications closed; withdrawing too.
    await prisma.opportunity.update({ where: { id: o.id }, data: { deadline: new Date(Date.now() - 1000) } });
    const late = await signUp(app);
    expect((await late.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'late' })).body.code).toBe('APPLICATIONS_CLOSED');
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/withdraw`)).body.code).toBe('DEADLINE_PASSED');
    // Past-deadline ones leave the default (open) browse list.
    expect((await request(app).get('/api/v1/opportunities')).body.items).toHaveLength(0);
  });

  it('a retried apply with the same Idempotency-Key is replayed, not refused', async () => {
    const org = await organiser();
    const o = await published(org);
    const fan = await signUp(app);
    const send = () =>
      fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).set('Idempotency-Key', 'apply-key-0001').send({ message: 'Hello' });
    expect((await send()).status).toBe(201);
    const again = await send();
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
  });

  it('organiser lists applicants and decides (audited); applicants and strangers cannot', async () => {
    const org = await organiser();
    const o = await published(org);
    const fan = await signUp(app);
    await fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'Pick me' });
    expect((await fan.agent.get(`/api/v1/opportunities/${o.id}/applications`)).status).toBe(403);
    const apps = await org.agent.get(`/api/v1/opportunities/${o.id}/applications`);
    expect(apps.body.items).toHaveLength(1);
    const appId = apps.body.items[0].id;
    expect((await fan.agent.post(`/api/v1/applications/${appId}/status`).send({ status: 'ACCEPTED' })).status).toBe(404);
    expect((await org.agent.post(`/api/v1/applications/${appId}/status`).send({ status: 'SHORTLISTED' })).body.status).toBe('SHORTLISTED');
    expect((await org.agent.post(`/api/v1/applications/${appId}/status`).send({ status: 'ACCEPTED' })).body.status).toBe('ACCEPTED');
    expect((await org.agent.post(`/api/v1/applications/${appId}/status`).send({ status: 'REJECTED' })).body.code).toBe(
      'INVALID_TRANSITION',
    );
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/withdraw`)).body.code).toBe('CANNOT_WITHDRAW');
    const audit = await prisma.auditLog.findMany({ where: { targetId: { in: [o.id, appId] } }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['opportunity.publish', 'opportunity.application.decide', 'opportunity.application.decide']);
    expect((await fan.agent.get(`/api/v1/opportunities/${o.id}`)).body.myApplication.status).toBe('ACCEPTED');
  });

  it('closing stops applications; a closed opportunity cannot be edited', async () => {
    const org = await organiser();
    const o = await published(org);
    expect((await org.agent.post(`/api/v1/opportunities/${o.id}/close`)).body.status).toBe('CLOSED');
    const fan = await signUp(app);
    expect((await fan.agent.post(`/api/v1/opportunities/${o.id}/apply`).send({ message: 'x' })).body.code).toBe('APPLICATIONS_CLOSED');
    expect((await org.agent.patch(`/api/v1/opportunities/${o.id}`).send({ title: 'Changed title here' })).body.code).toBe(
      'OPPORTUNITY_CLOSED',
    );
  });

  it('admin grants organiser access (reason required, audited); moderators and members cannot', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const mod = await makeStaff(app, 'MODERATOR');
    const target = await signUp(app, { primaryUse: 'PROFESSIONAL' });
    const body = { grant: true, reason: 'Verified event organiser' };
    expect((await mod.agent.post(`/api/v1/admin/users/${target.userId}/organiser`).set('Origin', ORIGIN).send(body)).status).toBe(403);
    expect((await target.agent.post(`/api/v1/admin/users/${target.userId}/organiser`).send(body)).status).toBe(403);
    expect((await admin.agent.post(`/api/v1/admin/users/${target.userId}/organiser`).send({ grant: true })).status).toBe(400);
    expect((await admin.agent.post(`/api/v1/admin/users/${target.userId}/organiser`).send(body)).body).toEqual({ isOrganiser: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).isOrganiser).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: target.userId, action: 'user.organiser.grant' } });
    expect(log.reason).toBe('Verified event organiser');
  });
});
