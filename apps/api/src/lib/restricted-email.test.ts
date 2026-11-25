import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMAIL_UNAVAILABLE_CODE } from '@muzikhub/shared';
import { prisma } from './prisma.js';
import {
  captureTransport,
  disabledTransport,
  emailAvailable,
  EmailUnavailableError,
  sendEmail,
  setEmailTransport,
  testOutbox,
} from './mailer.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../test/helpers.js';

const app = testApp();

beforeEach(async () => {
  await resetDatabase();
  testOutbox.length = 0;
  setEmailTransport(disabledTransport);
});
afterEach(() => setEmailTransport(null));

describe('disabled transport', () => {
  it('throws a typed error on every send and never drops a message silently', async () => {
    const message = { to: 'a@example.test', kind: 'password-reset' as const, subject: 's', html: '<p>h</p>', text: 't' };
    await expect(disabledTransport.send(message)).rejects.toBeInstanceOf(EmailUnavailableError);
    await expect(sendEmail(message)).rejects.toMatchObject({
      name: 'EmailUnavailableError',
      code: 'EMAIL_UNAVAILABLE',
      kind: 'password-reset',
    });
    expect(emailAvailable()).toBe(false);
    setEmailTransport(captureTransport);
    expect(emailAvailable()).toBe(true);
  });
});

describe('Better Auth in restricted-email mode', () => {
  it('sign-up succeeds, sends nothing and leaves the email unverified', async () => {
    const { agent, userId } = await signUp(app);
    expect(testOutbox).toHaveLength(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerified).toBe(false);
    // The rest of authentication is untouched: the session works.
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('password reset is refused with 503 EMAIL_UNAVAILABLE, identically for real and unknown addresses', async () => {
    const { input } = await signUp(app);
    const ask = (email: string) =>
      request(app)
        .post('/api/auth/request-password-reset')
        .set('Origin', ORIGIN)
        .send({ email, redirectTo: `${ORIGIN}/reset-password` });
    const real = await ask(input.email);
    const unknown = await ask('nobody-here@example.test');
    expect(real.status).toBe(503);
    expect(real.body).toMatchObject({ code: EMAIL_UNAVAILABLE_CODE });
    expect(unknown.status).toBe(real.status);
    expect(unknown.body).toEqual(real.body);
    expect(testOutbox).toHaveLength(0);
    // No reset token was created: nothing could ever be "sent".
    expect(await prisma.verification.count({ where: { identifier: { startsWith: 'reset-password' } } })).toBe(0);
  });

  it('resending the verification email is refused with the same 503, signed in or not', async () => {
    const { agent, input } = await signUp(app);
    const signedIn = await agent.post('/api/auth/send-verification-email').set('Origin', ORIGIN).send({ email: input.email });
    const anonymous = await request(app)
      .post('/api/auth/send-verification-email')
      .set('Origin', ORIGIN)
      .send({ email: 'nobody-here@example.test' });
    expect(signedIn.status).toBe(503);
    expect(signedIn.body).toMatchObject({ code: EMAIL_UNAVAILABLE_CODE });
    expect(anonymous.status).toBe(503);
    expect(anonymous.body).toEqual(signedIn.body);
    expect(testOutbox).toHaveLength(0);
  });

  it('sign-in, sign-out and the CSRF origin check still behave exactly as before', async () => {
    const { input } = await signUp(app);
    const agent = request.agent(app);
    const signIn = await agent.post('/api/auth/sign-in/email').set('Origin', ORIGIN).send({ email: input.email, password: input.password });
    expect(signIn.status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
    const forged = await agent.patch('/api/v1/me/profile').set('Origin', 'https://evil.example').send({ bio: 'x' });
    expect(forged.status).toBe(403);
    const wrong = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: 'wrong-password-1' });
    expect(wrong.status).toBe(401);
  });

  it('a verified email cannot be obtained another way: organiser access stays blocked', async () => {
    const { agent, userId } = await signUp(app, { primaryUse: 'PROFESSIONAL' });
    await prisma.user.update({ where: { id: userId }, data: { isOrganiser: true } });
    const status = await agent.get('/api/v1/opportunities/organiser-status');
    expect(status.body).toMatchObject({ canOrganise: false });
    expect(status.body.missing).toContain('VERIFIED_EMAIL');
  });
});

describe('GET /api/v1/capabilities', () => {
  it('reports email as unavailable in restricted mode, with no configuration values', async () => {
    const res = await request(app).get('/api/v1/capabilities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: { available: false, unavailableFeatures: ['password-reset', 'email-verification'] } });
    expect(JSON.stringify(res.body)).not.toMatch(/resend|re_|@|secret|key/i);
  });
  it('reports email as available when a transport can send', async () => {
    setEmailTransport(captureTransport);
    const res = await request(app).get('/api/v1/capabilities');
    expect(res.body).toEqual({ email: { available: true, unavailableFeatures: [] } });
  });
});
