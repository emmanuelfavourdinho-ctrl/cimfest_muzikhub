import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5435/muzikhub',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'https://api.muzikhub.test',
};
// Production also requires public https URLs (productionUrlProblems, tested in deploy-env.test.ts).
const prod = {
  ...base,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://muzikhub.test',
  WEB_APP_URL: 'https://muzikhub.test',
};
const problems = (source: Record<string, string>) => {
  const r = parseEnvironment(source);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('EMAIL_TRANSPORT startup rules (restricted-email mode)', () => {
  it('production still defaults to Resend and requires its key and sender: no insecure default', () => {
    const p = problems(prod);
    expect(p).toEqual(expect.arrayContaining([expect.stringMatching(/^RESEND_API_KEY/), expect.stringMatching(/^EMAIL_FROM/)]));
  });

  it('production refuses EMAIL_TRANSPORT=disabled without the explicit opt-in', () => {
    expect(problems({ ...prod, EMAIL_TRANSPORT: 'disabled' })).toEqual([
      'EMAIL_TRANSPORT: EMAIL_TRANSPORT=disabled is refused in production unless ALLOW_EMAIL_DISABLED_IN_PRODUCTION=true',
    ]);
  });

  it('production accepts EMAIL_TRANSPORT=disabled with ALLOW_EMAIL_DISABLED_IN_PRODUCTION=true and no Resend credentials', () => {
    const r = parseEnvironment({ ...prod, EMAIL_TRANSPORT: 'disabled', ALLOW_EMAIL_DISABLED_IN_PRODUCTION: 'true' });
    expect(r.success).toBe(true);
    expect(r.success && [r.data.EMAIL_TRANSPORT, r.data.REQUIRE_EMAIL_VERIFICATION]).toEqual(['disabled', false]);
  });

  it('refuses disabled email combined with mandatory email verification (would lock everyone out)', () => {
    for (const source of [
      { ...base, NODE_ENV: 'development', EMAIL_TRANSPORT: 'disabled', REQUIRE_EMAIL_VERIFICATION: 'true' },
      { ...prod, EMAIL_TRANSPORT: 'disabled', ALLOW_EMAIL_DISABLED_IN_PRODUCTION: 'true', REQUIRE_EMAIL_VERIFICATION: 'true' },
    ]) {
      expect(problems(source)).toContainEqual(
        expect.stringMatching(/^REQUIRE_EMAIL_VERIFICATION: cannot be true while EMAIL_TRANSPORT=disabled/),
      );
    }
  });

  it('refuses the opt-in flag when email is not actually disabled (contradictory configuration)', () => {
    const p = problems({
      ...prod,
      RESEND_API_KEY: 're_fake_key_for_tests',
      EMAIL_FROM: 'MuzikHub <no-reply@mail.muzikhub.test>',
      ALLOW_EMAIL_DISABLED_IN_PRODUCTION: 'true',
    });
    expect(p).toEqual([
      'ALLOW_EMAIL_DISABLED_IN_PRODUCTION: is set but EMAIL_TRANSPORT is not "disabled"; remove it so the configuration is unambiguous',
    ]);
  });

  it('production refuses the development transports, as before', () => {
    for (const t of ['console', 'capture']) {
      expect(problems({ ...prod, EMAIL_TRANSPORT: t })).toContainEqual(
        expect.stringMatching(/^EMAIL_TRANSPORT: production must send email/),
      );
    }
  });

  it('accepts disabled in development without any flag, and rejects unknown transports', () => {
    expect(parseEnvironment({ ...base, NODE_ENV: 'development', EMAIL_TRANSPORT: 'disabled' }).success).toBe(true);
    expect(parseEnvironment({ ...base, EMAIL_TRANSPORT: 'smtp' }).success).toBe(false);
  });

  it('never echoes values in its messages', () => {
    const p = problems({ ...prod, EMAIL_TRANSPORT: 'disabled' }).join('\n');
    expect(p).not.toContain('x'.repeat(40));
    expect(p).not.toContain('postgresql://');
  });
});
