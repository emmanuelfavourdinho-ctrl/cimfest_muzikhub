import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { resetRecipientLimits, setEmailTransport, testOutbox } from '../lib/mailer.js';
import { prisma } from '../lib/prisma.js';
import { FakeMediaStorage } from './fake-media-storage.js';
import { allRateLimiters } from '../lib/rate-limit.js';
import '../modules/admin/admin.routes.js';
import { secretFromUri, totp } from './totp.js';

export const ORIGIN = 'http://localhost:5173';

/** Shared fake Cloudinary for all integration tests (reset with the database). */
export const fakeMedia = new FakeMediaStorage();

export function testApp(): Express {
  return createApp({ checkDatabase: async () => true, media: fakeMedia });
}

/** Creates a READY media asset the way the browser would: sign → upload → confirm. */
export async function uploadMedia(
  agent: ReturnType<typeof request.agent>,
  { kind = 'IMAGE', purpose = 'PORTFOLIO' }: { kind?: 'IMAGE' | 'AUDIO' | 'VIDEO'; purpose?: string } = {},
): Promise<string> {
  const signed = await agent.post('/api/v1/media/uploads').send({ kind, purpose, bytes: 1000 });
  if (signed.status !== 201) throw new Error(`sign failed (${signed.status}): ${JSON.stringify(signed.body)}`);
  const resource =
    kind === 'IMAGE'
      ? { resourceType: 'image' as const, format: 'jpg', width: 800, height: 600 }
      : kind === 'VIDEO'
        ? { resourceType: 'video' as const, format: 'mp4', width: 1280, height: 720, durationSec: 30 }
        : { resourceType: 'video' as const, format: 'mp3', durationSec: 180 };
  fakeMedia.simulateUpload(signed.body.fields.public_id, resource);
  const confirmed = await agent.post(`/api/v1/media/${signed.body.assetId}/confirm`);
  if (confirmed.status !== 200) throw new Error(`confirm failed (${confirmed.status}): ${JSON.stringify(confirmed.body)}`);
  return signed.body.assetId as string;
}

/** Empties every table. Only ever runs against the *_test database (see global-setup). */
export async function resetDatabase() {
  if (!process.env.DATABASE_URL?.includes('muzikhub_test')) {
    throw new Error('resetDatabase called outside the test database');
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "user", "verification", "idempotency_key", "outbox_event", "service_catalogue", "payment_webhook_event", "analytics_seen", "community", "conversation", "competition" CASCADE',
  );
  // audit_log is append-only; TRUNCATE is permitted only inside a transaction that opts in.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SELECT set_config('muzikhub.allow_audit_truncate', 'on', true)`),
    prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_log"'),
  ]);
  for (const limiter of allRateLimiters()) limiter.reset();
  testOutbox.length = 0;
  resetRecipientLimits();
  setEmailTransport(null); // back to the capture transport
  fakeMedia.reset();
}

let counter = 0;
export function newUserInput(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    name: `Test User ${counter}`,
    email: `user${counter}-${Date.now()}@example.test`,
    username: `user${counter}${Date.now() % 100000}`,
    password: 'correct-horse-battery',
    primaryUse: 'CREATOR',
    ...overrides,
  };
}

/** Signs up through the real Better Auth endpoint; the agent keeps the session cookie. */
export async function signUp(app: Express, overrides: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  const input = newUserInput(overrides);
  const res = await agent.post('/api/auth/sign-up/email').set('Origin', ORIGIN).send(input);
  if (res.status !== 200) {
    throw new Error(`sign-up failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { agent, input, userId: res.body.user.id as string };
}

/**
 * A staff member set up the real way: verified email, platform role, and two-factor enrolled
 * through Better Auth's own endpoints (enable → verify a TOTP code). Returns the TOTP secret
 * so tests can sign in again with a second factor.
 */
export async function makeStaff(app: Express, role: 'MODERATOR' | 'ADMIN', { twoFactor = true } = {}) {
  const user = await signUp(app);
  await prisma.user.update({ where: { id: user.userId }, data: { platformRole: role, emailVerified: true } });
  let secret: string | null = null;
  if (twoFactor) {
    const enabled = await user.agent.post('/api/auth/two-factor/enable').set('Origin', ORIGIN).send({ password: user.input.password });
    if (enabled.status !== 200) throw new Error(`2FA enable failed: ${JSON.stringify(enabled.body)}`);
    secret = secretFromUri(enabled.body.totpURI);
    const verified = await user.agent
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', ORIGIN)
      .send({ code: totp(secret) });
    if (verified.status !== 200) throw new Error(`2FA verify failed: ${JSON.stringify(verified.body)}`);
  }
  return { ...user, secret };
}

/** Makes every session of a user look older than the fresh-session window. */
export async function ageSessions(userId: string, minutes = 60) {
  await prisma.session.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - minutes * 60_000) } });
}
