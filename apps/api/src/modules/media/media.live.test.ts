import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudinaryStorage } from '../../lib/media-storage.js';
import { prisma } from '../../lib/prisma.js';
import { resetDatabase, signUp } from '../../test/helpers.js';
import { createApp } from '../../app.js';
import { releaseAssets } from './media.service.js';

/**
 * Talks to the REAL Cloudinary account: run with `CLOUDINARY_LIVE=1 npx vitest run media.live`.
 * Uploads three tiny generated files into the `muzikhub/test/` folder and deletes them again.
 */
const live = process.env.CLOUDINARY_LIVE === '1';

describe.skipIf(!live)('Cloudinary (live)', () => {
  const storage = cloudinaryStorage();
  const app = createApp({ checkDatabase: async () => true, media: storage });
  const created: string[] = [];
  // Small real media files shared with the browser tests.
  const dir = join(import.meta.dirname, '../../../../../e2e/fixtures');

  beforeAll(resetDatabase);

  afterAll(async () => {
    await releaseAssets(created);
  });

  it.each([
    ['IMAGE', 'cover.png', 'image/png', 'medium'],
    ['AUDIO', 'beat.wav', 'audio/wav', 'src'],
    ['VIDEO', 'clip.webm', 'video/webm', 'poster'],
  ] as const)(
    '%s: sign → direct upload → verify → deliver',
    async (kind, file, mime, urlKey) => {
      expect(storage.configured).toBe(true);
      const { agent } = await signUp(app);
      const bytes = readFileSync(join(dir, file));

      const signed = await agent.post('/api/v1/media/uploads').send({ kind, purpose: 'POST', bytes: bytes.length, filename: file });
      expect(signed.status).toBe(201);
      created.push(signed.body.assetId);

      // Exactly what the browser does: multipart POST of the file + signed fields to Cloudinary.
      const form = new FormData();
      for (const [k, v] of Object.entries(signed.body.fields as Record<string, string>)) form.append(k, v);
      form.append('file', new Blob([bytes], { type: mime }), file);
      const upload = await fetch(signed.body.uploadUrl, { method: 'POST', body: form });
      expect(upload.status, await upload.clone().text()).toBe(200);

      const confirmed = await agent.post(`/api/v1/media/${signed.body.assetId}/confirm`);
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: signed.body.assetId } });
      expect(asset.status).toBe('READY');

      // The CDN URL really serves (this also proves the transformation syntax is valid).
      const url = confirmed.body.urls[urlKey] as string;
      const delivered = await fetch(url);
      expect(delivered.status, url).toBe(200);
    },
    60_000,
  );

  it('rejects a replayed signature trying to overwrite a verified file', async () => {
    const { agent } = await signUp(app);
    const png = readFileSync(join(dir, 'cover.png'));
    const signed = await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: png.length });
    created.push(signed.body.assetId);
    const send = () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(signed.body.fields as Record<string, string>)) form.append(k, v);
      form.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');
      return fetch(signed.body.uploadUrl, { method: 'POST', body: form }).then(
        (r) => r.json() as Promise<{ existing?: boolean; version?: number }>,
      );
    };
    const first = await send();
    await agent.post(`/api/v1/media/${signed.body.assetId}/confirm`);
    const replay = await send();
    // overwrite=false: Cloudinary keeps the original (same version) instead of replacing it.
    expect(replay.existing).toBe(true);
    expect(replay.version).toBe(first.version);
  }, 60_000);

  it('signature forgery is refused by Cloudinary', async () => {
    const { agent } = await signUp(app);
    const signed = await agent.post('/api/v1/media/uploads').send({ kind: 'IMAGE', purpose: 'POST', bytes: 100 });
    created.push(signed.body.assetId);
    const form = new FormData();
    // Attacker changes the target public_id to write somewhere else with the same signature.
    for (const [k, v] of Object.entries(signed.body.fields as Record<string, string>)) {
      form.append(k, k === 'public_id' ? 'muzikhub/test/someone-else/hijack' : v);
    }
    form.append('file', new Blob([readFileSync(join(dir, 'cover.png'))], { type: 'image/png' }), 'cover.png');
    const res = await fetch(signed.body.uploadUrl, { method: 'POST', body: form });
    expect(res.status).toBe(401);
  }, 60_000);
});
