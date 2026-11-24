import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);
type Agent = ReturnType<typeof request.agent>;
const H = 3_600_000;

async function organiser() {
  const u = await signUp(app, { primaryUse: 'PROFESSIONAL' });
  await prisma.user.update({ where: { id: u.userId }, data: { isOrganiser: true, emailVerified: true } });
  return u;
}
const input = (overrides: Record<string, unknown> = {}) => ({
  title: 'Douala Beat Battle 2026',
  description: 'Produce an original afrobeats instrumental under three minutes. Judged by working producers.',
  category: 'PRODUCTION',
  eligibility: 'Open to producers living in Cameroon, aged 16+.',
  rules: 'One original instrumental per person. Samples must be cleared or royalty-free. Max 3 minutes.',
  prize: 'Studio time worth 100,000 FCFA, offered by the organiser',
  prizePlaces: 2,
  judgingMethod: 'Two judges score each entry; the average decides.',
  disqualification: 'Uncleared samples, plagiarism or late submission.',
  disputeProcess: 'Open a dispute within 7 days of results; MuzikHub staff decide.',
  formats: ['LINK'],
  criteria: [
    { name: 'Originality', weight: 60 },
    { name: 'Mix', weight: 40 },
  ],
  opensAt: new Date(Date.now() - 60_000).toISOString(),
  closesAt: new Date(Date.now() + 2 * H).toISOString(),
  ...overrides,
});
const post = (agent: Agent, path: string, b: object = {}) => agent.post(`/api/v1/competitions${path}`).set('Origin', ORIGIN).send(b);
const enter = (agent: Agent, slug: string, version = 1, title = 'My beat') =>
  agent
    .put(`/api/v1/competitions/${slug}/entry`)
    .set('Origin', ORIGIN)
    .send({ title, externalUrl: 'https://soundcloud.com/me/beat', acceptedRulesVersion: version });
const close = (slug: string) =>
  prisma.competition.update({ where: { slug }, data: { opensAt: new Date(Date.now() - 3 * H), closesAt: new Date(Date.now() - 60_000) } });
const types = async (userId: string) => (await prisma.notification.findMany({ where: { userId } })).map((n) => n.type);

async function published() {
  const org = await organiser();
  const c = await post(org.agent, '', input());
  expect(c.status).toBe(201);
  expect((await post(org.agent, `/${c.body.slug}/publish`)).body.phase).toBe('OPEN');
  return { org, slug: c.body.slug as string };
}

describe('organising (D7)', () => {
  it('only approved organisers create; drafts are private; publishing lists it', async () => {
    const member = await signUp(app);
    expect((await post(member.agent, '', input())).body.code).toBe('NOT_AN_ORGANISER');
    const org = await organiser();
    const c = await post(org.agent, '', input());
    expect(c.body).toMatchObject({ phase: 'DRAFT', rulesVersion: 1 });
    expect((await request(app).get(`/api/v1/competitions/${c.body.slug}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/competitions')).body.items).toEqual([]);
    await post(org.agent, `/${c.body.slug}/publish`);
    const list = await request(app).get('/api/v1/competitions?phase=OPEN');
    expect(list.body.items.map((i: { slug: string }) => i.slug)).toEqual([c.body.slug]);
  });

  it('validates dates and criteria', async () => {
    const org = await organiser();
    expect((await post(org.agent, '', input({ closesAt: new Date(Date.now() - H).toISOString() }))).status).toBe(400);
    expect((await post(org.agent, '', input({ criteria: [{ name: 'Only', weight: 90 }] }))).status).toBe(400);
  });
});

describe('entering (COMP-003/004/006)', () => {
  it('rules must be the current version; one entry per person; confirmation; organisers and judges can’t enter', async () => {
    const { org, slug } = await published();
    const a = await signUp(app);
    const judge = await signUp(app);
    await post(org.agent, `/${slug}/judges`, { username: judge.input.username });
    expect((await enter(a.agent, slug, 2)).body.code).toBe('RULES_CHANGED');
    const e = await enter(a.agent, slug);
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ rulesVersion: 1, status: 'SUBMITTED' });
    expect(await types(a.userId)).toContain('competition.entry_received');
    expect((await enter(a.agent, slug, 1, 'Better version')).body.title).toBe('Better version');
    expect(await prisma.competitionEntry.count()).toBe(1);
    expect((await enter(org.agent, slug)).body.code).toBe('CANNOT_ENTER');
    expect((await enter(judge.agent, slug)).body.code).toBe('CANNOT_ENTER');
  });

  it('no late entries; a recorded extension reopens it (audited, entrants told)', async () => {
    const { org, slug } = await published();
    const a = await signUp(app);
    const b = await signUp(app);
    await enter(a.agent, slug);
    await close(slug);
    expect((await enter(b.agent, slug)).body.code).toBe('CANNOT_ENTER');
    const ext = await post(org.agent, `/${slug}/extend`, {
      until: new Date(Date.now() + H).toISOString(),
      reason: 'Power cuts across Douala this week',
    });
    expect(ext.body).toMatchObject({ phase: 'OPEN', extensionReason: 'Power cuts across Douala this week' });
    expect((await enter(b.agent, slug)).status).toBe(200);
    expect(await types(a.userId)).toContain('competition.extended');
    expect(await prisma.auditLog.count({ where: { action: 'competition.extend' } })).toBe(1);
  });

  it('changing rules after publishing makes a new version; entrants are told; old entries keep theirs', async () => {
    const { org, slug } = await published();
    const a = await signUp(app);
    await enter(a.agent, slug);
    const upd = await org.agent
      .patch(`/api/v1/competitions/${slug}`)
      .set('Origin', ORIGIN)
      .send({ rules: 'One original instrumental per person. Max 2 minutes now, sorry. Samples must be cleared.' });
    expect(upd.body.rulesVersion).toBe(2);
    expect(await types(a.userId)).toContain('competition.rules_updated');
    expect((await a.agent.get(`/api/v1/competitions/${slug}/entry`)).body.rulesVersion).toBe(1);
    expect(
      (
        await org.agent
          .patch(`/api/v1/competitions/${slug}`)
          .set('Origin', ORIGIN)
          .send({ closesAt: new Date(Date.now() + 5 * H).toISOString() })
      ).body.code,
    ).toBe('LOCKED_AFTER_PUBLISH');
    const b = await signUp(app);
    expect((await enter(b.agent, slug, 1)).body.code).toBe('RULES_CHANGED');
    expect((await enter(b.agent, slug, 2)).status).toBe(200);
  });
});

describe('judging and results (COMP-005/007)', () => {
  async function judged() {
    const { org, slug } = await published();
    const judge = await signUp(app);
    await post(org.agent, `/${slug}/judges`, { username: judge.input.username });
    const a = await signUp(app);
    const b = await signUp(app);
    const c = await signUp(app);
    await enter(a.agent, slug, 1, 'Entry A');
    await enter(b.agent, slug, 1, 'Entry B');
    await enter(c.agent, slug, 1, 'Entry C');
    return { org, slug, judge, a, b, c };
  }
  const score = (agent: Agent, id: string, o: number, m: number, feedback?: string) =>
    agent
      .put(`/api/v1/competition-entries/${id}/score`)
      .set('Origin', ORIGIN)
      .send({ scores: { Originality: o, Mix: m }, ...(feedback && { feedback }) });

  it('judges see entries only after closing; scores need every criterion; results only when complete; frozen after', async () => {
    const { org, slug, judge, a, c } = await judged();
    expect((await judge.agent.get(`/api/v1/competitions/${slug}/entries`)).body.code).toBe('NOT_YET');
    expect((await a.agent.get(`/api/v1/competitions/${slug}/entries`)).status).toBe(403);
    await close(slug);
    const entries = (await judge.agent.get(`/api/v1/competitions/${slug}/entries`)).body.items as { id: string; title: string }[];
    const id = (t: string) => entries.find((e) => e.title === t)!.id;
    expect(
      (
        await judge.agent
          .put(`/api/v1/competition-entries/${id('Entry A')}/score`)
          .set('Origin', ORIGIN)
          .send({ scores: { Originality: 5 } })
      ).status,
    ).toBe(400);
    await score(judge.agent, id('Entry A'), 9, 8, 'Great drums');
    await score(judge.agent, id('Entry B'), 6, 6);
    expect((await post(org.agent, `/${slug}/results`)).body.code).toBe('JUDGING_INCOMPLETE');
    // Before publication nobody sees results.
    expect((await request(app).get(`/api/v1/competitions/${slug}`)).body.results).toEqual([]);
    await org.agent
      .post(`/api/v1/competition-entries/${id('Entry C')}/disqualify`)
      .set('Origin', ORIGIN)
      .send({ reason: 'Uses an uncleared sample' });
    expect(await types(c.userId)).toContain('competition.disqualified');
    const res = await post(org.agent, `/${slug}/results`);
    expect(res.body.phase).toBe('RESULTS');
    expect(res.body.results.map((r: { placement: number; entry: { title: string } }) => `${r.placement}:${r.entry.title}`)).toEqual([
      '1:Entry A',
      '2:Entry B',
    ]);
    expect(await types(a.userId)).toContain('competition.results');
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: a.userId, type: 'competition.results' } })).title).toMatch(
      /placed #1/,
    );
    // The entrant now sees the feedback (judge anonymous to them); scores are final.
    const mine = await a.agent.get(`/api/v1/competitions/${slug}/entry`);
    expect(mine.body.judgements[0]).toMatchObject({ feedback: 'Great drums', judge: null, total: 86 });
    expect((await score(judge.agent, id('Entry B'), 10, 10)).body.code).toBe('RESULTS_FINAL');
    expect(await prisma.auditLog.count({ where: { action: 'competition.results.publish' } })).toBe(1);
  });

  it('disputes: entrants only, once, within the window; an admin decides (audited, both told)', async () => {
    const { org, slug, judge, a } = await judged();
    await close(slug);
    for (const e of (await judge.agent.get(`/api/v1/competitions/${slug}/entries`)).body.items) await score(judge.agent, e.id, 5, 5);
    await post(org.agent, `/${slug}/results`);
    const outsider = await signUp(app);
    expect((await post(outsider.agent, `/${slug}/disputes`, { reason: 'I think the results are wrong somehow' })).body.code).toBe(
      'CANNOT_DISPUTE',
    );
    const d = await post(a.agent, `/${slug}/disputes`, { reason: 'All entries scored identically; the judging looks incomplete.' });
    expect(d.status).toBe(201);
    expect((await post(a.agent, `/${slug}/disputes`, { reason: 'Second complaint about the same thing' })).status).toBe(409);
    const mod = await makeStaff(app, 'MODERATOR');
    expect((await mod.agent.get('/api/v1/admin/competition-disputes')).status).toBe(403);
    const admin = await makeStaff(app, 'ADMIN');
    expect((await admin.agent.get('/api/v1/admin/competition-disputes?status=OPEN')).body.items).toHaveLength(1);
    const res = await admin.agent
      .post(`/api/v1/admin/competition-disputes/${d.body.id}/resolve`)
      .set('Origin', ORIGIN)
      .send({ outcome: 'REJECTED', resolution: 'Scores were reviewed with the judge and stand as published.' });
    expect(res.body.status).toBe('REJECTED');
    expect(await types(a.userId)).toContain('competition.dispute_decided');
    expect(await types(org.userId)).toContain('competition.dispute_decided');
    expect(await prisma.auditLog.count({ where: { action: 'competition.dispute.resolve' } })).toBe(1);
  });
});

describe('moderation', () => {
  it('a competition can be reported and removed by platform staff', async () => {
    const { slug } = await published();
    const c = await prisma.competition.findUniqueOrThrow({ where: { slug } });
    const reporter = await signUp(app);
    expect(
      (
        await reporter.agent
          .post('/api/v1/reports')
          .set('Origin', ORIGIN)
          .send({ targetType: 'COMPETITION', targetId: c.id, reason: 'SPAM' })
      ).status,
    ).toBe(201);
    const mod = await makeStaff(app, 'MODERATOR');
    const listed = await mod.agent.get('/api/v1/admin/content?type=competition');
    expect(listed.status).toBe(200);
    expect(listed.body.items.find((i: { id: string }) => i.id === c.id)).toMatchObject({
      kind: 'competition',
      openReports: 1,
      link: `/competitions/${slug}`,
    });
    expect(
      (
        await mod.agent
          .post(`/api/v1/admin/content/competition/${c.id}/remove`)
          .set('Origin', ORIGIN)
          .send({ reason: 'Fake prize; organiser unreachable' })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`/api/v1/competitions/${slug}`)).status).toBe(404);
    const removed = await mod.agent.get('/api/v1/admin/content?type=competition&state=removed');
    expect(removed.body.items.map((i: { id: string }) => i.id)).toContain(c.id);
  });
});
