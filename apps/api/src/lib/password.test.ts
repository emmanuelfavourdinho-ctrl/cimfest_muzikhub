import { hashPassword as betterAuthDefaultHash } from '@better-auth/utils/password';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';
import { CURRENT_PARAMS, hashPassword, needsRehash, parseHash, PRODUCTION_PARAMS, verifyPassword } from './password.js';
import { ORIGIN, resetDatabase, signUp, testApp } from '../test/helpers.js';

describe('password hashing (scrypt, ADR 0001)', () => {
  it('production parameters meet the OWASP minimum (N=2^17, r=8, p=1) and round-trip', async () => {
    expect(PRODUCTION_PARAMS).toEqual({ ln: 17, r: 8, p: 1 });
    const hash = await hashPassword('correct-horse-battery', PRODUCTION_PARAMS);
    expect(hash).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-batterz')).toBe(false);
  });

  it('salts every hash, normalises Unicode (NFKC) and rejects tampered hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('ｐａｓｓword-1'), hashPassword('ｐａｓｓword-1')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'password-1')).toBe(true); // full-width → ASCII under NFKC
    expect(await verifyPassword(a.slice(0, -2) + 'AA', 'password-1')).toBe(false);
    expect(await verifyPassword('$scrypt$ln=30,r=8,p=1$AAAA$AAAA', 'x')).toBe(false); // absurd cost refused
    expect(await verifyPassword('not a hash', 'x')).toBe(false);
  });

  it("still verifies Better Auth's default format and flags it for rehash", async () => {
    const legacy = await betterAuthDefaultHash('correct-horse-battery');
    expect(parseHash(legacy)).toEqual({ kind: 'legacy' });
    expect(await verifyPassword(legacy, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(legacy, 'wrong-password-123')).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword('x-password-1'))).toBe(false);
    expect(needsRehash('$scrypt$ln=14,r=8,p=1$AAAA$AAAA', PRODUCTION_PARAMS)).toBe(true);
  });
});

describe('rehash on sign-in', () => {
  const app = testApp();
  beforeEach(resetDatabase);

  it('a user with an old Better Auth hash signs in normally and is upgraded in place', async () => {
    const { input, userId } = await signUp(app);
    const legacy = await betterAuthDefaultHash(input.password);
    await prisma.account.updateMany({ where: { userId, providerId: 'credential' }, data: { password: legacy } });

    const res = await (
      await import('supertest')
    )
      .default(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: input.password });
    expect(res.status).toBe(200);

    await expect
      .poll(async () => (await prisma.account.findFirstOrThrow({ where: { userId, providerId: 'credential' } })).password, {
        timeout: 5000,
      })
      .toMatch(new RegExp(`^\\$scrypt\\$ln=${CURRENT_PARAMS.ln},r=8,p=1\\$`));
    // …and the upgraded hash works.
    const again = await (
      await import('supertest')
    )
      .default(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: input.password });
    expect(again.status).toBe(200);
  });

  it('a wrong password never triggers a rehash', async () => {
    const { input, userId } = await signUp(app);
    const legacy = await betterAuthDefaultHash(input.password);
    await prisma.account.updateMany({ where: { userId, providerId: 'credential' }, data: { password: legacy } });
    const res = await (
      await import('supertest')
    )
      .default(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: input.email, password: 'definitely-wrong-1' }); // gitleaks:allow — deliberately wrong test password
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 300));
    expect((await prisma.account.findFirstOrThrow({ where: { userId, providerId: 'credential' } })).password).toBe(legacy);
  });

  it('new sign-ups are stored in the new format', async () => {
    const { userId } = await signUp(app);
    const { password } = await prisma.account.findFirstOrThrow({ where: { userId, providerId: 'credential' } });
    expect(parseHash(password!)).toEqual({ kind: 'scrypt', params: CURRENT_PARAMS });
  });
});
