import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();

beforeEach(resetDatabase);

describe('/api/v1/me requires authentication', () => {
  it.each([
    ['get', '/api/v1/me'],
    ['patch', '/api/v1/me/profile'],
    ['put', '/api/v1/me/profile/links'],
    ['post', '/api/v1/me/onboarding/complete'],
  ] as const)('%s %s → 401 without a session', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('PATCH /api/v1/me/profile (FR-06, FR-08)', () => {
  it('persists multiple roles, genres and details', async () => {
    const { agent } = await signUp(app);
    const res = await agent.patch('/api/v1/me/profile').send({
      roles: ['PRODUCER', 'AUDIO_ENGINEER', 'PRODUCER'],
      genres: ['afrobeats', 'amapiano'],
      bio: '  Crafting cross-border sounds.  ',
      location: 'Buea, Cameroon',
      careerStage: 'DEVELOPING',
      goals: ['find_collaborators'],
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.roles).toEqual(['PRODUCER', 'AUDIO_ENGINEER']); // de-duplicated
    expect(res.body.profile.bio).toBe('Crafting cross-border sounds.'); // trimmed

    const again = await agent.get('/api/v1/me');
    expect(again.body.profile.genres).toEqual(['afrobeats', 'amapiano']);
  });

  it('rejects unknown values and unknown fields', async () => {
    const { agent } = await signUp(app);
    const badGenre = await agent.patch('/api/v1/me/profile').send({ genres: ['not_a_genre'] });
    expect(badGenre.status).toBe(400);
    expect(badGenre.body.error.code).toBe('VALIDATION_ERROR');

    // .strict(): server-controlled fields cannot be smuggled in through the profile endpoint.
    const escalation = await agent.patch('/api/v1/me/profile').send({ platformRole: 'ADMIN' });
    expect(escalation.status).toBe(400);
  });

  it('never moves onboarding progress backwards', async () => {
    const { agent } = await signUp(app);
    await agent.patch('/api/v1/me/profile').send({ onboardingStep: 3 });
    const res = await agent.patch('/api/v1/me/profile').send({ onboardingStep: 1 });
    expect(res.body.profile.onboardingStep).toBe(3);
  });
});

describe('PUT /api/v1/me/profile/links (CLAUDE.md §6.2)', () => {
  it('derives the platform from the hostname and keeps the given order', async () => {
    const { agent } = await signUp(app);
    const res = await agent.put('/api/v1/me/profile/links').send({
      links: [
        { url: 'https://www.youtube.com/@ayonova', platform: 'SPOTIFY' }, // client label ignored
        { url: 'https://open.spotify.com/artist/123' },
        { url: 'https://ayonova.example.com' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.links.map((l: { platform: string }) => l.platform)).toEqual([
      'YOUTUBE',
      'SPOTIFY',
      'WEBSITE',
    ]);
  });

  it('rejects unsafe URL schemes', async () => {
    const { agent } = await signUp(app);
    for (const url of ['javascript:alert(1)', 'http://open.spotify.com/x', 'data:text/html,x']) {
      const res = await agent.put('/api/v1/me/profile/links').send({ links: [{ url }] });
      expect(res.status, url).toBe(400);
    }
  });

  it('replaces the list rather than appending', async () => {
    const { agent } = await signUp(app);
    await agent.put('/api/v1/me/profile/links').send({ links: [{ url: 'https://x.com/a' }, { url: 'https://x.com/b' }] });
    const res = await agent.put('/api/v1/me/profile/links').send({ links: [{ url: 'https://x.com/c' }] });
    expect(res.body.profile.links).toHaveLength(1);
  });
});

describe('ownership', () => {
  it("a user's edits only ever change their own profile", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    await bob.agent.patch('/api/v1/me/profile').send({ bio: 'Bob was here' });

    const aliceProfile = await prisma.profile.findUniqueOrThrow({ where: { userId: alice.userId } });
    expect(aliceProfile.bio).toBeNull();
  });
});

describe('GET /api/v1/profiles/:username (FR-10)', () => {
  it('returns the public profile without private fields', async () => {
    const { agent, input } = await signUp(app, { username: 'zuri.motion' });
    await agent.patch('/api/v1/me/profile').send({ roles: ['DANCER'] });

    const res = await request(app).get('/api/v1/profiles/Zuri.Motion');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('zuri.motion');
    expect(res.body.roles).toEqual(['DANCER']);
    expect(JSON.stringify(res.body)).not.toContain(input.email);
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('platformRole');
  });

  it('returns 404 for unknown and suspended users alike', async () => {
    expect((await request(app).get('/api/v1/profiles/nobody_here')).status).toBe(404);

    const { userId } = await signUp(app, { username: 'gone.user' });
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    expect((await request(app).get('/api/v1/profiles/gone.user')).status).toBe(404);
  });
});

describe('POST /api/v1/me/onboarding/complete (FR-05)', () => {
  it('is idempotent: completing twice keeps the first timestamp', async () => {
    const { agent } = await signUp(app);
    const first = await agent.post('/api/v1/me/onboarding/complete');
    const second = await agent.post('/api/v1/me/onboarding/complete');
    expect(first.body.profile.onboardingCompletedAt).toBeTruthy();
    expect(second.body.profile.onboardingCompletedAt).toBe(first.body.profile.onboardingCompletedAt);
  });
});
