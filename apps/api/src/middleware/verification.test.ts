import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { resetDatabase, signUp, testApp } from '../test/helpers.js';

// Decision C2: email verification is a config flag (off until a sending domain is verified).
describe('REQUIRE_EMAIL_VERIFICATION', () => {
  const app = testApp();
  const original = env.REQUIRE_EMAIL_VERIFICATION;
  beforeEach(resetDatabase);
  afterEach(() => {
    (env as { REQUIRE_EMAIL_VERIFICATION: boolean }).REQUIRE_EMAIL_VERIFICATION = original;
  });

  it('is off by default: unverified members can publish', async () => {
    expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(false);
    const { agent } = await signUp(app);
    expect((await agent.post('/api/v1/posts').send({ body: 'hello' })).status).toBe(201);
  });

  it('when on: unverified members cannot post, comment or publish work; verified members can', async () => {
    (env as { REQUIRE_EMAIL_VERIFICATION: boolean }).REQUIRE_EMAIL_VERIFICATION = true;
    const { agent, userId } = await signUp(app);
    const post = await agent.post('/api/v1/posts').send({ body: 'hello' });
    expect(post.status).toBe(403);
    expect(post.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
    const item = await agent
      .post('/api/v1/portfolio')
      .send({ type: 'AUDIO', title: 'Demo', externalUrl: 'https://example.com/a', visibility: 'PUBLIC' });
    expect(item.status).toBe(201); // drafts are allowed — publishing is what's gated
    expect((await agent.post(`/api/v1/portfolio/${item.body.id}/publish`).send({ shareToFeed: false })).body.code).toBe(
      'EMAIL_NOT_VERIFIED',
    );

    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    const ok = await agent.post('/api/v1/posts').send({ body: 'verified now' });
    expect(ok.status).toBe(201);
    expect((await agent.post(`/api/v1/posts/${ok.body.id}/comments`).send({ body: 'first' })).status).toBe(201);
    expect((await agent.post(`/api/v1/portfolio/${item.body.id}/publish`).send({ shareToFeed: false })).status).toBe(200);
  });

  it('when on: comments by unverified members are refused', async () => {
    const author = await signUp(app);
    const post = await author.agent.post('/api/v1/posts').send({ body: 'open thread' });
    (env as { REQUIRE_EMAIL_VERIFICATION: boolean }).REQUIRE_EMAIL_VERIFICATION = true;
    const { agent } = await signUp(app);
    expect((await agent.post(`/api/v1/posts/${post.body.id}/comments`).send({ body: 'hi' })).body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
