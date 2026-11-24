import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { fakeMedia, resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);

async function creator() {
  const user = await signUp(app);
  const audio = await uploadMedia(user.agent, { kind: 'AUDIO' });
  const cover = await uploadMedia(user.agent, { kind: 'IMAGE' });
  return { ...user, audio, cover };
}

describe('portfolio lifecycle (draft → publish → edit → archive → delete)', () => {
  it('works end to end for the owner and stays consistent for visitors', async () => {
    const { agent, input, audio, cover } = await creator();

    const draft = await agent.post('/api/v1/portfolio').send({
      type: 'BEAT',
      title: 'Midnight Makossa',
      description: 'Afro-house instrumental, 122 BPM.',
      genres: ['makossa', 'afro_house'],
      mediaId: audio,
      coverId: cover,
    });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', visibility: 'PUBLIC', isOwner: true });
    expect(draft.body.media.urls.src).toBeTruthy();
    const id = draft.body.id;

    // Drafts are invisible to everyone else.
    expect((await request(app).get(`/api/v1/portfolio/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/profiles/${input.username}/portfolio`)).body.items).toHaveLength(0);

    const published = await agent.post(`/api/v1/portfolio/${id}/publish`).send({ shareToFeed: false });
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publishedAt).toBeTruthy();

    const visitor = await request(app).get(`/api/v1/portfolio/${id}`);
    expect(visitor.status).toBe(200);
    expect(visitor.body.isOwner).toBe(false);
    expect(visitor.body.owner.username).toBe(input.username);
    const list = await request(app).get(`/api/v1/profiles/${input.username}/portfolio`);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([id]);

    const edited = await agent.patch(`/api/v1/portfolio/${id}`).send({ title: 'Midnight Makossa (Extended)', featured: true });
    expect(edited.body).toMatchObject({ title: 'Midnight Makossa (Extended)', featured: true });

    const archived = await agent.post(`/api/v1/portfolio/${id}/archive`);
    expect(archived.body.status).toBe('ARCHIVED');
    expect((await request(app).get(`/api/v1/portfolio/${id}`)).status).toBe(404);

    const mine = await agent.get('/api/v1/me/portfolio?status=ARCHIVED');
    expect(mine.body.items).toHaveLength(1);

    const coverPublicId = (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: cover } })).publicId;
    expect((await agent.delete(`/api/v1/portfolio/${id}`)).status).toBe(204);
    expect(await prisma.portfolioItem.count()).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(0); // media and cover removed…
    expect(fakeMedia.destroyed).toContain(coverPublicId); // …from Cloudinary too
  });

  it('private published work is visible only to its owner', async () => {
    const { agent, input, cover } = await creator();
    const res = await agent
      .post('/api/v1/portfolio')
      .send({ type: 'IMAGE', title: 'Unreleased artwork', mediaId: cover, visibility: 'PRIVATE', publish: true });
    expect(res.status).toBe(201);
    expect((await request(app).get(`/api/v1/portfolio/${res.body.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/profiles/${input.username}/portfolio`)).body.items).toHaveLength(0);
    expect((await agent.get(`/api/v1/profiles/${input.username}/portfolio`)).body.items).toHaveLength(1);
  });
});

describe('publish requirements', () => {
  it.each([
    [{ type: 'IMAGE', title: 'x' }, 'an image item without an image'],
    [{ type: 'BEAT', title: 'x' }, 'a beat without audio or a link'],
    [{ type: 'PROJECT', title: 'x' }, 'a project without description or link'],
  ])('refuses to publish %j (%s), but saves it as a draft', async (body) => {
    const { agent } = await signUp(app);
    const publish = await agent.post('/api/v1/portfolio').send({ ...body, publish: true });
    expect(publish.status).toBe(400);
    expect(publish.body.code).toBe('NOT_PUBLISHABLE');
    expect((await agent.post('/api/v1/portfolio').send(body)).status).toBe(201);
  });

  it('accepts a link instead of an upload, and detects the platform', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/portfolio').send({
      type: 'VIDEO',
      title: 'Live at Douala',
      externalUrl: 'https://youtu.be/abc123',
      publish: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.externalPlatform).toBe('YOUTUBE');
  });

  it('rejects unsafe external links', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'x', externalUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });

  it('cannot remove the only media from published work', async () => {
    const { agent, cover } = await creator();
    const item = await agent.post('/api/v1/portfolio').send({ type: 'IMAGE', title: 'x', mediaId: cover, publish: true });
    const res = await agent.patch(`/api/v1/portfolio/${item.body.id}`).send({ mediaId: null });
    expect(res.body.code).toBe('NOT_PUBLISHABLE');
  });
});

describe('attachments', () => {
  it('rejects media of the wrong kind for the type', async () => {
    const { agent, audio, cover } = await creator();
    expect((await agent.post('/api/v1/portfolio').send({ type: 'IMAGE', title: 'x', mediaId: audio })).status).toBe(400);
    expect((await agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'x', coverId: audio })).status).toBe(400);
    const beat = await agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'x', mediaId: audio });
    // Switching type must re-check the attached file.
    expect((await agent.patch(`/api/v1/portfolio/${beat.body.id}`).send({ type: 'IMAGE' })).status).toBe(400);
    expect(cover).toBeTruthy();
  });

  it("can't attach someone else's upload or reuse one file in two items", async () => {
    const alice = await creator();
    const bob = await signUp(app);
    expect((await bob.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'stolen', mediaId: alice.audio })).status).toBe(400);

    expect((await alice.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'one', mediaId: alice.audio })).status).toBe(201);
    const twice = await alice.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'two', mediaId: alice.audio });
    expect(twice.status).toBe(409);
  });

  it('replacing a file removes the old one', async () => {
    const { agent, audio } = await creator();
    const item = await agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'x', mediaId: audio });
    const replacement = await uploadMedia(agent, { kind: 'AUDIO' });
    await agent.patch(`/api/v1/portfolio/${item.body.id}`).send({ mediaId: replacement });
    expect(await prisma.mediaAsset.count({ where: { id: audio } })).toBe(0);
  });
});

describe('ownership', () => {
  it("other users can't edit, publish, archive or delete your work (reported as not found)", async () => {
    const alice = await creator();
    const bob = await signUp(app);
    const item = await alice.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'mine', mediaId: alice.audio, publish: true });
    const id = item.body.id;

    expect((await bob.agent.patch(`/api/v1/portfolio/${id}`).send({ title: 'hacked' })).status).toBe(404);
    expect((await bob.agent.post(`/api/v1/portfolio/${id}/archive`)).status).toBe(404);
    expect((await bob.agent.post(`/api/v1/portfolio/${id}/publish`).send({})).status).toBe(404);
    expect((await bob.agent.delete(`/api/v1/portfolio/${id}`)).status).toBe(404);
    expect((await prisma.portfolioItem.findUniqueOrThrow({ where: { id } })).title).toBe('mine');
  });

  it('requires a session to create', async () => {
    expect((await request(app).post('/api/v1/portfolio').send({ type: 'PROJECT', title: 'x' })).status).toBe(401);
  });

  it("a suspended owner's work disappears publicly", async () => {
    const alice = await creator();
    const item = await alice.agent.post('/api/v1/portfolio').send({ type: 'BEAT', title: 'x', mediaId: alice.audio, publish: true });
    await prisma.user.update({ where: { id: alice.userId }, data: { status: 'SUSPENDED' } });
    expect((await request(app).get(`/api/v1/portfolio/${item.body.id}`)).status).toBe(404);
  });
});

describe('share to feed (approved: opt-in)', () => {
  it('creates exactly one showcase post, only when asked, and only for public work', async () => {
    const { agent, audio, cover } = await creator();
    const shared = await agent
      .post('/api/v1/portfolio')
      .send({ type: 'BEAT', title: 'x', mediaId: audio, publish: true, shareToFeed: true });
    expect(await prisma.post.count({ where: { portfolioItemId: shared.body.id, type: 'SHOWCASE' } })).toBe(1);

    // Publishing again (e.g. after un-archiving) never duplicates the post.
    await agent.post(`/api/v1/portfolio/${shared.body.id}/archive`);
    await agent.post(`/api/v1/portfolio/${shared.body.id}/publish`).send({ shareToFeed: true });
    expect(await prisma.post.count({ where: { portfolioItemId: shared.body.id } })).toBe(1);

    const notShared = await agent.post('/api/v1/portfolio').send({ type: 'IMAGE', title: 'y', mediaId: cover, publish: true });
    expect(await prisma.post.count({ where: { portfolioItemId: notShared.body.id } })).toBe(0);

    // Making work private removes it from the feed.
    await agent.patch(`/api/v1/portfolio/${shared.body.id}`).send({ visibility: 'PRIVATE' });
    expect(await prisma.post.count({ where: { portfolioItemId: shared.body.id } })).toBe(0);
  });

  it('refuses to share private work', async () => {
    const { agent, audio } = await creator();
    const res = await agent
      .post('/api/v1/portfolio')
      .send({ type: 'BEAT', title: 'x', mediaId: audio, visibility: 'PRIVATE', publish: true, shareToFeed: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_SHAREABLE');
  });
});

describe('pagination', () => {
  it('pages through a portfolio with a cursor', async () => {
    const { agent, input } = await signUp(app);
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/v1/portfolio').send({ type: 'PROJECT', title: `p${i}`, description: 'd', publish: true });
    }
    const first = await request(app).get(`/api/v1/profiles/${input.username}/portfolio?limit=3`);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app).get(`/api/v1/profiles/${input.username}/portfolio?limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
    expect(new Set(all).size).toBe(5);
  });
});
