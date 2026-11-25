import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { fakeMedia, resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';
import { cleanupMedia } from './media.service.js';

const app = testApp();
beforeEach(resetDatabase);

describe('POST /api/v1/media/uploads — signing', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'AVATAR', bytes: 1000 });
    expect(res.status).toBe(401);
  });

  it("signs an upload into the user's own folder with format limits and no overwrite", async () => {
    const { agent, userId } = await signUp(app);
    const res = await agent
      .post('/api/v1/media/uploads')
      .send({ kind: 'AUDIO', purpose: 'PORTFOLIO', bytes: 5_000_000, filename: 'demo.wav' });
    expect(res.status).toBe(201);
    expect(res.body.fields.public_id).toBe(`muzikhub/test/${userId}/${res.body.assetId}`);
    expect(res.body.fields.allowed_formats).toContain('mp3');
    expect(res.body.fields.allowed_formats).not.toContain('mp4');
    expect(res.body.fields.overwrite).toBe('false');
    expect(res.body.fields).not.toHaveProperty('api_secret');
    expect(res.body.uploadUrl).toMatch(/\/video\/upload$/); // audio uses resource_type=video
    expect(res.body.chunked).toBe(false);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: res.body.assetId } });
    expect(asset.status).toBe('PENDING');
  });

  it('rejects unknown fields instead of silently dropping them (mass-assignment guard)', async () => {
    const { agent } = await signUp(app);
    const res = await agent
      .post('/api/v1/media/uploads')
      .send({ kind: 'IMAGE', purpose: 'POST', bytes: 1000, ownerId: 'someone-else', folder: 'muzikhub/other' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('marks large files for chunked upload', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/media/uploads').send({ kind: 'VIDEO', purpose: 'POST', bytes: 60 * 1024 * 1024 });
    expect(res.body.chunked).toBe(true);
    expect(res.body.chunkBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it.each([
    [{ kind: 'VIDEO', purpose: 'AVATAR', bytes: 1000 }, 'video as an avatar'],
    [{ kind: 'IMAGE', purpose: 'COVER', bytes: 11 * 1024 * 1024 }, 'an image over 10 MB'],
    [{ kind: 'VIDEO', purpose: 'POST', bytes: 101 * 1024 * 1024 }, 'a video over 100 MB'],
    [{ kind: 'DOCUMENT', purpose: 'POST', bytes: 1000 }, 'an unknown kind'],
  ])('rejects %j (%s)', async (body) => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/v1/media/uploads').send(body);
    expect(res.status).toBe(400);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('limits how many unfinished uploads a user can hold', async () => {
    const { agent } = await signUp(app);
    for (let i = 0; i < 20; i++) {
      expect((await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 1000 })).status).toBe(201);
    }
    const res = await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 1000 });
    expect(res.status).toBe(429);
  });

  it('returns 503 when Cloudinary is not configured', async () => {
    const { agent } = await signUp(app);
    fakeMedia.configured = false;
    const res = await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 1000 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MEDIA_NOT_CONFIGURED');
  });
});

describe('POST /api/v1/media/:id/confirm — verification', () => {
  async function sign(agent: ReturnType<typeof request.agent>, kind = 'IMAGE', purpose = 'POST') {
    const res = await agent.post('/api/v1/media/uploads').send({ kind, purpose, bytes: 1000 });
    return res.body as { assetId: string; fields: { public_id: string } };
  }

  it('reports an unfinished upload as retryable, not as success', async () => {
    const { agent } = await signUp(app);
    const { assetId } = await sign(agent);
    const res = await agent.post(`/api/v1/media/${assetId}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UPLOAD_INCOMPLETE');
  });

  it('stores what Cloudinary actually holds and returns delivery URLs (idempotent)', async () => {
    const { agent } = await signUp(app);
    const { assetId, fields } = await sign(agent);
    fakeMedia.simulateUpload(fields.public_id, { resourceType: 'image', format: 'png', bytes: 4321, width: 1600, height: 900, version: 7 });

    const res = await agent.post(`/api/v1/media/${assetId}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: assetId, kind: 'IMAGE', width: 1600, height: 900 });
    expect(res.body.urls.medium).toBeTruthy();

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset).toMatchObject({ status: 'READY', bytes: 4321, format: 'png', version: 7 });

    expect((await agent.post(`/api/v1/media/${assetId}/confirm`)).status).toBe(200);
  });

  it("can't confirm someone else's upload (reported as not found)", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const { assetId, fields } = await sign(alice.agent);
    fakeMedia.simulateUpload(fields.public_id, { resourceType: 'image', format: 'jpg' });
    const res = await bob.agent.post(`/api/v1/media/${assetId}/confirm`);
    expect(res.status).toBe(404);
  });

  it.each([
    ['an unsupported format', 'IMAGE', { resourceType: 'image' as const, format: 'svg' }],
    ['a file larger than declared limits', 'IMAGE', { resourceType: 'image' as const, format: 'jpg', bytes: 50 * 1024 * 1024 }],
    ['a video uploaded as audio', 'AUDIO', { resourceType: 'video' as const, format: 'mp3', width: 1280, height: 720 }],
    ['audio over 20 minutes', 'AUDIO', { resourceType: 'video' as const, format: 'mp3', durationSec: 21 * 60 }],
  ])('rejects %s and deletes it from Cloudinary', async (_label, kind, resource) => {
    const { agent } = await signUp(app);
    const { assetId, fields } = await sign(agent, kind);
    fakeMedia.simulateUpload(fields.public_id, resource);

    const res = await agent.post(`/api/v1/media/${assetId}/confirm`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MEDIA_REJECTED');
    expect(fakeMedia.destroyed).toContain(fields.public_id);
    expect(await prisma.mediaAsset.count({ where: { id: assetId } })).toBe(0);
  });
});

describe('profile photo and cover', () => {
  it('sets an avatar from a verified upload, and replacing it removes the old file', async () => {
    const { agent, input } = await signUp(app);
    const first = await uploadMedia(agent, { purpose: 'AVATAR' });
    const set = await agent.put('/api/v1/me/profile/avatar').send({ mediaId: first });
    expect(set.status).toBe(200);
    expect(set.body.profile.image).toContain('sq192');

    const publicView = await request(app).get(`/api/v1/profiles/${input.username}`);
    expect(publicView.body.image).toContain('sq192');

    const firstPublicId = (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: first } })).publicId;
    const second = await uploadMedia(agent, { purpose: 'AVATAR' });
    await agent.put('/api/v1/me/profile/avatar').send({ mediaId: second });
    expect(fakeMedia.destroyed).toContain(firstPublicId);
    expect(await prisma.mediaAsset.count({ where: { id: first } })).toBe(0);

    const cleared = await agent.put('/api/v1/me/profile/avatar').send({ mediaId: null });
    expect(cleared.body.profile.image).toBeNull();
  });

  it('refuses media that is not yours, not verified, or uploaded for another purpose', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const bobsImage = await uploadMedia(bob.agent, { purpose: 'AVATAR' });
    expect((await alice.agent.put('/api/v1/me/profile/avatar').send({ mediaId: bobsImage })).status).toBe(400);

    const pending = (await alice.agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'AVATAR', bytes: 1000 })).body.assetId;
    const notReady = await alice.agent.put('/api/v1/me/profile/avatar').send({ mediaId: pending });
    expect(notReady.body.code).toBe('MEDIA_NOT_READY');

    const coverImage = await uploadMedia(alice.agent, { purpose: 'COVER' });
    expect((await alice.agent.put('/api/v1/me/profile/avatar').send({ mediaId: coverImage })).status).toBe(400);
    expect((await alice.agent.put('/api/v1/me/profile/cover').send({ mediaId: coverImage })).status).toBe(200);
  });
});

describe('DELETE /api/v1/media/:id', () => {
  it('deletes an unused upload, but not one that is in use', async () => {
    const { agent } = await signUp(app);
    const unused = await uploadMedia(agent, { purpose: 'AVATAR' });
    expect((await agent.delete(`/api/v1/media/${unused}`)).status).toBe(204);
    expect(await prisma.mediaAsset.count({ where: { id: unused } })).toBe(0);

    const inUse = await uploadMedia(agent, { purpose: 'AVATAR' });
    await agent.put('/api/v1/me/profile/avatar').send({ mediaId: inUse });
    const res = await agent.delete(`/api/v1/media/${inUse}`);
    expect(res.status).toBe(409);
  });
});

describe('cleanupMedia', () => {
  it('removes stale unconfirmed and unattached uploads, and retries failed deletions', async () => {
    const { agent } = await signUp(app);
    await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 1000 }); // never uploaded
    const orphan = await uploadMedia(agent, { purpose: 'POST' }); // verified but never attached
    const keep = await uploadMedia(agent, { purpose: 'AVATAR' });
    await agent.put('/api/v1/me/profile/avatar').send({ mediaId: keep });

    // A Cloudinary outage during cleanup leaves rows marked for retry rather than lost.
    fakeMedia.failDestroy = true;
    const future = new Date(Date.now() + 60_000);
    const failed = await cleanupMedia(future);
    expect(failed.failed).toBe(2);
    expect(await prisma.mediaAsset.count({ where: { status: 'DELETING' } })).toBe(2);

    fakeMedia.failDestroy = false;
    const retried = await cleanupMedia(future);
    expect(retried.removed).toBe(2);
    expect(await prisma.mediaAsset.findMany({ select: { id: true } })).toEqual([{ id: keep }]);
    expect(orphan).not.toBe(keep);
  });
});
