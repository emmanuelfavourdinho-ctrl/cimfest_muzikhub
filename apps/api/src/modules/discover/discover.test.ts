import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);

async function person(overrides: Record<string, unknown>, profile: Record<string, unknown>) {
  const user = await signUp(app, overrides);
  await user.agent.patch('/api/v1/me/profile').send(profile);
  return user;
}

const names = (res: { body: { items: { username: string }[] } }) => res.body.items.map((p) => p.username).sort();

describe('GET /api/v1/discover/people', () => {
  it('filters by role, genre, location and text — against real profiles', async () => {
    const kora = await person(
      { username: 'kora.beats', name: 'Kora Beats' },
      { roles: ['PRODUCER', 'AUDIO_ENGINEER'], genres: ['afrobeats'], location: 'Buea, Cameroon', skills: ['Logic Pro'] },
    );
    const ayo = await person(
      { username: 'ayo.nova', name: 'Ayo Nova' },
      { roles: ['SINGER', 'SONGWRITER'], genres: ['afro_fusion', 'soul'], location: 'Douala, Cameroon', bio: 'Melody-driven Afrobeats.' },
    );
    await person({ username: 'dj.north', name: 'DJ North' }, { roles: ['DJ'], genres: ['afro_house'], location: 'Limbé' });

    expect(names(await request(app).get('/api/v1/discover/people?roles=PRODUCER'))).toEqual(['kora.beats']);
    expect(names(await request(app).get('/api/v1/discover/people?roles=DJ,SINGER'))).toEqual(['ayo.nova', 'dj.north']);
    expect(names(await request(app).get('/api/v1/discover/people?genres=soul'))).toEqual(['ayo.nova']);
    expect(names(await request(app).get('/api/v1/discover/people?location=cameroon'))).toEqual(['ayo.nova', 'kora.beats']);
    expect(names(await request(app).get('/api/v1/discover/people?q=kora'))).toEqual(['kora.beats']); // name
    expect(names(await request(app).get('/api/v1/discover/people?q=melody'))).toEqual(['ayo.nova']); // bio
    expect(names(await request(app).get('/api/v1/discover/people?q=Logic%20Pro'))).toEqual(['kora.beats']); // skill
    expect(names(await request(app).get('/api/v1/discover/people?roles=PRODUCER&genres=soul'))).toEqual([]); // AND across filters
    expect(kora.userId && ayo.userId).toBeTruthy();
  });

  it('rejects unknown filter values instead of ignoring them', async () => {
    expect((await request(app).get('/api/v1/discover/people?roles=WIZARD')).status).toBe(400);
  });

  it('excludes yourself and suspended users; flags people you follow; counts only public work', async () => {
    const me = await signUp(app);
    const followed = await signUp(app);
    const suspended = await signUp(app);
    await prisma.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } });
    await me.agent.put(`/api/v1/users/${followed.input.username}/follow`);
    await followed.agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'public', description: 'd', publish: true });
    await followed.agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'draft', description: 'd' });

    const res = await me.agent.get('/api/v1/discover/people');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ username: followed.input.username, following: true, publishedWorkCount: 1 });
  });

  it('returns an honest empty result', async () => {
    expect((await request(app).get('/api/v1/discover/people?q=nobody')).body).toEqual({ items: [], nextCursor: null });
  });
});

describe('GET /api/v1/discover/work', () => {
  it('returns only published public work, filterable by type and genre', async () => {
    const { agent } = await signUp(app);
    const audio = await uploadMedia(agent, { kind: 'AUDIO' });
    await agent
      .post('/api/v1/portfolio')
      .send({ type: 'BEAT', title: 'Amapiano loop', genres: ['amapiano'], mediaId: audio, publish: true });
    await agent
      .post('/api/v1/portfolio')
      .send({ type: 'PROJECT', title: 'Hidden', description: 'd', visibility: 'PRIVATE', publish: true });
    await agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'Draft', description: 'd' });

    const all = await request(app).get('/api/v1/discover/work');
    expect(all.body.items.map((i: { title: string }) => i.title)).toEqual(['Amapiano loop']);
    expect((await request(app).get('/api/v1/discover/work?types=VIDEO')).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/discover/work?genres=amapiano&q=loop')).body.items).toHaveLength(1);
  });
});
