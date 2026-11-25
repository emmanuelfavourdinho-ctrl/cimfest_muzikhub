import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { fakeMedia, resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';

const app = testApp();
beforeEach(resetDatabase);

describe('creating posts', () => {
  it('derives the type from attachments', async () => {
    const { agent } = await signUp(app);
    const text = await agent.post('/api/v1/posts').send({ body: 'In the studio tonight.' });
    expect(text.body.type).toBe('TEXT');

    const images = await Promise.all([uploadMedia(agent, { purpose: 'POST' }), uploadMedia(agent, { purpose: 'POST' })]);
    const gallery = await agent.post('/api/v1/posts').send({ body: 'Session shots', mediaIds: images });
    expect(gallery.body.type).toBe('IMAGE');
    expect(gallery.body.media).toHaveLength(2);

    const audio = await uploadMedia(agent, { kind: 'AUDIO', purpose: 'POST' });
    expect((await agent.post('/api/v1/posts').send({ mediaIds: [audio] })).body.type).toBe('AUDIO');

    const video = await uploadMedia(agent, { kind: 'VIDEO', purpose: 'POST' });
    const v = await agent.post('/api/v1/posts').send({ mediaIds: [video] });
    expect(v.body.type).toBe('VIDEO');
    expect(v.body.media[0].urls.poster).toBeTruthy();
  });

  it.each([
    ['empty post', {}],
    ['five images', { count: 5 }],
  ])('rejects an %s', async (_l, opts: { count?: number }) => {
    const { agent } = await signUp(app);
    const mediaIds = opts.count ? await Promise.all(Array.from({ length: opts.count }, () => uploadMedia(agent, { purpose: 'POST' }))) : [];
    expect((await agent.post('/api/v1/posts').send({ body: '', mediaIds })).status).toBe(400);
  });

  it('rejects mixed media, two videos, and media uploaded for another purpose or by someone else', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const img = await uploadMedia(alice.agent, { purpose: 'POST' });
    const aud = await uploadMedia(alice.agent, { kind: 'AUDIO', purpose: 'POST' });
    expect((await alice.agent.post('/api/v1/posts').send({ mediaIds: [img, aud] })).status).toBe(400);

    const v1 = await uploadMedia(alice.agent, { kind: 'VIDEO', purpose: 'POST' });
    const v2 = await uploadMedia(alice.agent, { kind: 'VIDEO', purpose: 'POST' });
    expect((await alice.agent.post('/api/v1/posts').send({ mediaIds: [v1, v2] })).status).toBe(400);

    const avatar = await uploadMedia(alice.agent, { purpose: 'AVATAR' });
    expect((await alice.agent.post('/api/v1/posts').send({ mediaIds: [avatar] })).status).toBe(400);
    expect((await bob.agent.post('/api/v1/posts').send({ mediaIds: [img] })).status).toBe(400);
    expect(await prisma.post.count()).toBe(0);
  });
});

describe('the feed', () => {
  it('discover shows everyone’s posts newest first; following shows only followed people and you', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const carol = await signUp(app);
    await bob.agent.post('/api/v1/posts').send({ body: 'bob 1' });
    await carol.agent.post('/api/v1/posts').send({ body: 'carol 1' });
    await alice.agent.post('/api/v1/posts').send({ body: 'alice 1' });
    await alice.agent.put(`/api/v1/users/${bob.input.username}/follow`);

    const discover = await request(app).get('/api/v1/feed?tab=discover');
    expect(discover.body.items.map((p: { body: string }) => p.body)).toEqual(['alice 1', 'carol 1', 'bob 1']);

    const following = await alice.agent.get('/api/v1/feed?tab=following');
    expect(following.body.items.map((p: { body: string }) => p.body)).toEqual(['alice 1', 'bob 1']);

    expect((await request(app).get('/api/v1/feed?tab=following')).status).toBe(401);
  });

  it('paginates without gaps or duplicates', async () => {
    const { agent } = await signUp(app);
    for (let i = 0; i < 7; i++) await agent.post('/api/v1/posts').send({ body: `post ${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(app).get(`/api/v1/feed?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...res.body.items.map((p: { id: string }) => p.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('showcase posts link to the portfolio item and disappear when the work is archived', async () => {
    const { agent } = await signUp(app);
    const audio = await uploadMedia(agent, { kind: 'AUDIO' });
    const item = await agent
      .post('/api/v1/portfolio')
      .send({ type: 'BEAT', title: 'Showcase me', mediaId: audio, publish: true, shareToFeed: true });

    const feed = await request(app).get('/api/v1/feed');
    expect(feed.body.items[0]).toMatchObject({ type: 'SHOWCASE', portfolioItem: { id: item.body.id, title: 'Showcase me' } });

    await agent.post(`/api/v1/portfolio/${item.body.id}/archive`);
    expect((await request(app).get('/api/v1/feed')).body.items).toHaveLength(0);
  });

  it("hides suspended authors' posts", async () => {
    const { agent, userId } = await signUp(app);
    await agent.post('/api/v1/posts').send({ body: 'hello' });
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    expect((await request(app).get('/api/v1/feed')).body.items).toHaveLength(0);
  });

  it('is empty — not filled with sample content — when nobody has posted', async () => {
    const res = await request(app).get('/api/v1/feed');
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });
});

describe('editing and deleting posts', () => {
  it('only the author can edit or delete; deleting removes the media from Cloudinary', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const img = await uploadMedia(alice.agent, { purpose: 'POST' });
    const post = await alice.agent.post('/api/v1/posts').send({ body: 'original', mediaIds: [img] });
    const publicId = (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: img } })).publicId;

    expect((await bob.agent.patch(`/api/v1/posts/${post.body.id}`).send({ body: 'hacked' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/v1/posts/${post.body.id}`)).status).toBe(404);

    const edited = await alice.agent.patch(`/api/v1/posts/${post.body.id}`).send({ body: 'edited' });
    expect(edited.body).toMatchObject({ body: 'edited' });
    expect(edited.body.editedAt).toBeTruthy();

    expect((await alice.agent.delete(`/api/v1/posts/${post.body.id}`)).status).toBe(204);
    expect(fakeMedia.destroyed).toContain(publicId);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});

describe('likes and comments', () => {
  it('likes are idempotent and counted from rows', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const post = await alice.agent.post('/api/v1/posts').send({ body: 'like me' });
    const path = `/api/v1/posts/${post.body.id}/like`;

    expect((await bob.agent.put(path)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await bob.agent.put(path)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await bob.agent.get(`/api/v1/posts/${post.body.id}`)).body.likedByMe).toBe(true);
    expect((await alice.agent.get(`/api/v1/posts/${post.body.id}`)).body.likedByMe).toBe(false);
    expect((await bob.agent.delete(path)).body).toEqual({ liked: false, likeCount: 0 });
    expect((await request(app).put(path)).status).toBe(401);
  });

  it('comments: anyone signed in can comment; the commenter or the post author can delete', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const carol = await signUp(app);
    const post = await alice.agent.post('/api/v1/posts').send({ body: 'thoughts?' });
    const c1 = await bob.agent.post(`/api/v1/posts/${post.body.id}/comments`).send({ body: 'Fire 🔥' });
    expect(c1.status).toBe(201);
    const c2 = await carol.agent.post(`/api/v1/posts/${post.body.id}/comments`).send({ body: 'Nice mix' });

    const list = await alice.agent.get(`/api/v1/posts/${post.body.id}/comments`);
    expect(list.body.items.map((c: { body: string }) => c.body)).toEqual(['Fire 🔥', 'Nice mix']);
    expect(list.body.items.every((c: { canDelete: boolean }) => c.canDelete)).toBe(true); // alice owns the post

    expect((await carol.agent.delete(`/api/v1/comments/${c1.body.id}`)).status).toBe(404); // not hers
    expect((await alice.agent.delete(`/api/v1/comments/${c1.body.id}`)).status).toBe(204); // post author
    expect((await carol.agent.delete(`/api/v1/comments/${c2.body.id}`)).status).toBe(204); // own comment
    expect((await request(app).get(`/api/v1/posts/${post.body.id}`)).body.commentCount).toBe(0);
    expect((await bob.agent.post(`/api/v1/posts/${post.body.id}/comments`).send({ body: '' })).status).toBe(400);
  });
});

describe('reports', () => {
  it('stores one report per person per item, and refuses self-reports', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const post = await alice.agent.post('/api/v1/posts').send({ body: 'spammy?' });
    const body = { targetType: 'POST', targetId: post.body.id, reason: 'SPAM' };
    expect((await bob.agent.post('/api/v1/reports').send(body)).status).toBe(201);
    expect((await bob.agent.post('/api/v1/reports').send(body)).status).toBe(201);
    expect(await prisma.report.count()).toBe(1);
    expect((await alice.agent.post('/api/v1/reports').send(body)).status).toBe(400);
    expect((await bob.agent.post('/api/v1/reports').send({ ...body, targetId: 'missing' })).status).toBe(404);

    expect(
      (await bob.agent.post('/api/v1/reports').send({ targetType: 'PROFILE', targetId: alice.input.username, reason: 'IMPERSONATION' }))
        .status,
    ).toBe(201);
  });
});
