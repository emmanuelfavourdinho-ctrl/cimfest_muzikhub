import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { testOutbox } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { newUserInput, ORIGIN, resetDatabase, signUp, testApp } from '../../test/helpers.js';

const app = testApp();

beforeEach(resetDatabase);

describe('registration (FR-01, FR-03)', () => {
  it('creates the account, its profile, and a session', async () => {
    const { agent, input } = await signUp(app, { username: 'Ayo.Nova' });

    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.profile.username).toBe('ayo.nova'); // normalised to lower case
    expect(me.body.profile.primaryUse).toBe('CREATOR');
    expect(me.body.email).toBe(input.email);
    expect(me.body.platformRole).toBe('USER');
    expect(me.body.profile.onboardingCompletedAt).toBeNull();
  });

  it('requires a valid primary use', async () => {
    const missing = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send(newUserInput({ primaryUse: undefined }));
    expect(missing.status).toBe(400);

    const invalid = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send(newUserInput({ primaryUse: 'WIZARD' }));
    expect(invalid.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects reserved, malformed, and duplicate usernames (case-insensitive)', async () => {
    for (const username of ['admin', 'a', 'bad name']) {
      const res = await request(app).post('/api/auth/sign-up/email').set('Origin', ORIGIN).send(newUserInput({ username }));
      expect(res.status, username).toBe(400);
    }

    await signUp(app, { username: 'kora_beats' });
    const dup = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send(newUserInput({ username: 'KORA_BEATS' }));
    expect(dup.status).toBe(400);
  });

  it('ignores attempts to self-assign a platform role or status', async () => {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send(newUserInput({ platformRole: 'ADMIN', status: 'ACTIVE' }));
    // Better Auth rejects input:false fields outright; either way no admin may exist.
    if (res.status === 200) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
      expect(user.platformRole).toBe('USER');
    } else {
      expect(res.status).toBe(400);
    }
    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(0);
  });

  it('stores a hashed password, never the plain text', async () => {
    const { input, userId } = await signUp(app);
    const account = await prisma.account.findFirstOrThrow({ where: { userId } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(input.password);
  });
});

describe('sign-in and sign-out (FR-02)', () => {
  it('signs in with username or email, and rejects a wrong password', async () => {
    const { input } = await signUp(app);

    const byUsername = await request(app)
      .post('/api/auth/sign-in/username')
      .set('Origin', ORIGIN)
      .send({ username: input.username, password: input.password });
    expect(byUsername.status).toBe(200);

    const byEmail = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: input.password });
    expect(byEmail.status).toBe(200);

    const wrong = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: 'not-the-password' });
    expect(wrong.status).toBe(401);
  });

  it('sign-out ends the session', async () => {
    const { agent } = await signUp(app);
    expect((await agent.get('/api/v1/me')).status).toBe(200);

    const out = await agent.post('/api/auth/sign-out').set('Origin', ORIGIN).send({});
    expect(out.status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('emails a link, resets the password, and revokes existing sessions', async () => {
    const { agent, input } = await signUp(app);

    const requested = await request(app)
      .post('/api/auth/request-password-reset')
      .set('Origin', ORIGIN)
      .send({ email: input.email, redirectTo: `${ORIGIN}/reset-password` });
    expect(requested.status).toBe(200);

    const email = testOutbox.find((m) => m.to === input.email && /reset/i.test(m.subject));
    expect(email).toBeDefined();
    const token = email!.text.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', ORIGIN)
      .send({ token, newPassword: 'a-brand-new-password' });
    expect(reset.status).toBe(200);

    // The session that existed before the reset is gone.
    expect((await agent.get('/api/v1/me')).status).toBe(401);

    const oldPw = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: input.password });
    expect(oldPw.status).toBe(401);

    const newPw = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: 'a-brand-new-password' });
    expect(newPw.status).toBe(200);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@example.test', redirectTo: `${ORIGIN}/reset-password` });
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(0);
  });
});

describe('account status enforcement', () => {
  it('blocks a suspended user from the API and from signing in again', async () => {
    const { agent, input, userId } = await signUp(app);
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });

    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('ACCOUNT_INACTIVE');

    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: input.password });
    expect(signIn.status).toBe(403);
  });
});

describe('email verification (optional, approved 2026-11-24)', () => {
  it('sends a verification email on sign-up whose link returns to the web app, and verifying works', async () => {
    const { agent, input } = await signUp(app);
    const email = testOutbox.find((m) => m.to === input.email && m.kind === 'email-verification');
    expect(email).toBeDefined();
    const link = email!.text.match(/https?:\/\/\S+verify-email\S+/)?.[0];
    expect(link).toBeTruthy();
    const url = new URL(link!);
    expect(url.searchParams.get('callbackURL')).toBe('http://localhost:5173/email-verified');
    expect(email!.html).toContain('Confirm my email');

    // Unverified users keep full access (verification isn't required yet).
    expect((await agent.get('/api/v1/me')).body.emailVerified).toBe(false);

    const res = await agent.get(`${url.pathname}${url.search}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/email-verified');
    expect((await agent.get('/api/v1/me')).body.emailVerified).toBe(true);
  });

  it('an invalid link returns to the web app with an error instead of raw JSON', async () => {
    const res = await request(app).get(
      `/api/auth/verify-email?token=not-a-real-token&callbackURL=${encodeURIComponent('http://localhost:5173/email-verified')}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/localhost:5173\/email-verified\?error=/);
  });

  it('resend-verification is limited per recipient (the response never changes)', async () => {
    const { agent, input } = await signUp(app); // 1st email
    for (let i = 0; i < 4; i++) {
      const res = await agent.post('/api/auth/send-verification-email').set('Origin', ORIGIN).send({ email: input.email });
      expect(res.status).toBe(200);
    }
    const sent = testOutbox.filter((m) => m.to === input.email && m.kind === 'email-verification');
    expect(sent).toHaveLength(3); // capped by the per-recipient limit
  });

  it('password-reset and verification emails escape the user name in HTML', async () => {
    const { input } = await signUp(app, { name: '<b>Bold</b> Ayo' });
    const email = testOutbox.find((m) => m.to === input.email)!;
    expect(email.html).toContain('&lt;b&gt;Bold&lt;/b&gt; Ayo');
    expect(email.html).not.toContain('<b>Bold</b>');
  });
});
