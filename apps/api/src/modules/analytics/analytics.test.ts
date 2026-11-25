import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);

type Agent = ReturnType<typeof request.agent>;
const DAY = 86_400_000;

async function grantPlan(userId: string, plan: 'CREATOR_PLUS' | 'PRO') {
  await prisma.subscription.create({
    data: { userId, plan, periodStart: new Date(Date.now() - DAY), periodEnd: new Date(Date.now() + 30 * DAY) },
  });
}
async function creatorWithWork() {
  const u = await signUp(app);
  const audio = await uploadMedia(u.agent, { kind: 'AUDIO' });
  const work = await u.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'Midnight Makossa', mediaId: audio, publish: true });
  const linked = await u.agent
    .post('/api/v1/portfolio')
    .send({ type: 'VIDEO', title: 'Live at Douala', externalUrl: 'https://youtu.be/abc123', publish: true });
  await u.agent.put('/api/v1/me/profile/links').send({ links: [{ url: 'https://open.spotify.com/artist/x' }] });
  const link = await prisma.profileLink.findFirstOrThrow({ where: { profileId: u.userId } });
  return { ...u, workId: work.body.id as string, linkedId: linked.body.id as string, linkId: link.id };
}
const event = (agent: Agent | ReturnType<typeof request>, body: object, ua = 'Mozilla/5.0 test') =>
  agent.post('/api/v1/analytics/events').set('User-Agent', ua).send(body);
const counters = (ownerId: string) => prisma.analyticsDaily.findMany({ where: { ownerId } });

describe('collection', () => {
  it('counts a profile view server-side, once per viewer per day; the owner never counts', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    for (let i = 0; i < 3; i += 1) await fan.agent.get(`/api/v1/profiles/${owner.input.username}`).set('User-Agent', 'Mozilla/5.0');
    await owner.agent.get(`/api/v1/profiles/${owner.input.username}`);
    const rows = await counters(owner.userId);
    expect(rows).toEqual([expect.objectContaining({ event: 'PROFILE_VIEW', subjectType: 'PROFILE', count: 1 })]);
    // A different (signed-out) viewer is another view.
    await request(app).get(`/api/v1/profiles/${owner.input.username}`).set('User-Agent', 'Other browser');
    expect((await counters(owner.userId))[0]!.count).toBe(2);
  });

  it('counts plays and link clicks on the owner’s own public work and links; repeats are ignored', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    for (let i = 0; i < 2; i += 1) {
      expect((await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId })).status).toBe(204);
      await event(fan.agent, { event: 'LINK_CLICK', subjectType: 'PROFILE_LINK', subjectId: owner.linkId });
      await event(fan.agent, { event: 'LINK_CLICK', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.linkedId });
    }
    const rows = await counters(owner.userId);
    expect(rows.map((r) => `${r.event}:${r.subjectType}:${r.count}`).sort()).toEqual(
      ['LINK_CLICK:PORTFOLIO_ITEM:1', 'LINK_CLICK:PROFILE_LINK:1', 'PLAY:PORTFOLIO_ITEM:1'].sort(),
    );
  });

  it('ignores the owner, bots, invalid pairs, unknown or private subjects — and never says which', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    await event(owner.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId }, 'Googlebot/2.1');
    await event(fan.agent, { event: 'PLAY', subjectType: 'PROFILE_LINK', subjectId: owner.linkId }); // a link can't be played
    await event(fan.agent, { event: 'LINK_CLICK', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId }); // no external link
    const missing = await event(fan.agent, { event: 'PLAY', subjectType: 'POST', subjectId: 'nope' });
    expect(missing.status).toBe(204);
    await prisma.portfolioItem.update({ where: { id: owner.workId }, data: { visibility: 'PRIVATE' } });
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    expect(await counters(owner.userId)).toEqual([]);
    expect((await event(fan.agent, { event: 'PROFILE_VIEW', subjectType: 'PROFILE', subjectId: owner.userId })).status).toBe(400);
  });

  it('stores no personal data: only daily counters and a daily-keyed hash for de-duplication', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    const seen = await prisma.analyticsSeen.findFirstOrThrow();
    expect(seen.viewerHash).not.toContain(fan.userId);
    expect(Object.keys(seen).sort()).toEqual(['day', 'event', 'subjectId', 'viewerHash']);
  });
});

describe('API: plan-gated, own data only, history limits', () => {
  it('Free → 403; Creator Plus → totals and series capped at 30 days, no per-item', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    await fan.agent.get(`/api/v1/profiles/${owner.input.username}`);
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    const free = await owner.agent.get('/api/v1/analytics/summary');
    expect(free.status).toBe(403);
    expect(free.body.code).toBe('PLAN_REQUIRED');

    await grantPlan(owner.userId, 'CREATOR_PLUS');
    const res = await owner.agent.get('/api/v1/analytics/summary?days=365');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ days: 30, maxDays: 30, itemAnalytics: false, totals: { views: 1, plays: 1, clicks: 0 } });
    expect(res.body.series).toHaveLength(30);
    expect((await owner.agent.get('/api/v1/analytics/items')).status).toBe(403);
  });

  it('history older than the plan allows is not returned (Plus 30 days, Pro 365)', async () => {
    const owner = await creatorWithWork();
    await prisma.analyticsDaily.create({
      data: {
        ownerId: owner.userId,
        day: new Date(Date.now() - 100 * DAY),
        event: 'PLAY',
        subjectType: 'PORTFOLIO_ITEM',
        subjectId: owner.workId,
        count: 7,
      },
    });
    await grantPlan(owner.userId, 'CREATOR_PLUS');
    expect((await owner.agent.get('/api/v1/analytics/summary?days=365')).body.totals.plays).toBe(0);
    await grantPlan(owner.userId, 'PRO');
    const pro = await owner.agent.get('/api/v1/analytics/summary?days=365');
    expect(pro.body).toMatchObject({ days: 365, totals: { plays: 7 } });
  });

  it('Pro: per-item breakdown with titles and links', async () => {
    const owner = await creatorWithWork();
    const fan = await signUp(app);
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    await event(fan.agent, { event: 'LINK_CLICK', subjectType: 'PROFILE_LINK', subjectId: owner.linkId });
    await grantPlan(owner.userId, 'PRO');
    const res = await owner.agent.get('/api/v1/analytics/items?days=30');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectType: 'PORTFOLIO_ITEM', title: 'Midnight Makossa', plays: 1, link: `/work/${owner.workId}` }),
        expect.objectContaining({ subjectType: 'PROFILE_LINK', title: 'open.spotify.com', clicks: 1, link: null }),
      ]),
    );
  });

  it('users only ever see their own analytics; signed out → 401', async () => {
    const owner = await creatorWithWork();
    const other = await creatorWithWork();
    const fan = await signUp(app);
    await event(fan.agent, { event: 'PLAY', subjectType: 'PORTFOLIO_ITEM', subjectId: owner.workId });
    await grantPlan(other.userId, 'PRO');
    expect((await other.agent.get('/api/v1/analytics/summary')).body.totals).toEqual({ views: 0, plays: 0, clicks: 0 });
    expect((await other.agent.get('/api/v1/analytics/items')).body.items).toEqual([]);
    expect((await request(app).get('/api/v1/analytics/summary')).status).toBe(401);
  });

  it('expiry: analytics access ends at the plan’s end', async () => {
    const owner = await creatorWithWork();
    await prisma.subscription.create({
      data: { userId: owner.userId, plan: 'PRO', periodStart: new Date(Date.now() - 31 * DAY), periodEnd: new Date(Date.now() - 1000) },
    });
    expect((await owner.agent.get('/api/v1/analytics/summary')).status).toBe(403);
  });
});
