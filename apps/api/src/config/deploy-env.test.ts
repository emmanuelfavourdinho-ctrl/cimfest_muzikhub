import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env.js';

/** Deployment startup rules: public https URLs in production, and the setup B proxy secret. */
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5435/muzikhub',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'https://muzikhub.vercel.app',
  WEB_APP_URL: 'https://muzikhub.vercel.app',
  CORS_ORIGINS: 'https://muzikhub.vercel.app',
  EMAIL_TRANSPORT: 'disabled',
  ALLOW_EMAIL_DISABLED_IN_PRODUCTION: 'true',
};
const problems = (source: Record<string, string>) => {
  const r = parseEnvironment(source);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('production URL rules', () => {
  it('accepts the setup B configuration (everything on the Vercel origin)', () => {
    expect(problems(prod)).toEqual([]);
  });

  it('refuses the localhost defaults when the variables are missing', () => {
    const { CORS_ORIGINS: _c, WEB_APP_URL: _w, ...missing } = prod;
    const p = problems(missing);
    expect(p).toContainEqual(expect.stringMatching(/^CORS_ORIGINS: must be an https URL on a public host/));
    expect(p).toContainEqual(expect.stringMatching(/^WEB_APP_URL: must be an https URL on a public host/));
  });

  it('refuses http and local hosts, and never echoes the value', () => {
    for (const value of ['http://muzikhub.vercel.app', 'https://localhost:5173', 'https://127.0.0.1', 'https://[::1]']) {
      const p = problems({ ...prod, BETTER_AUTH_URL: value });
      expect(p).toEqual(['BETTER_AUTH_URL: must be an https URL on a public host in production (not http: or localhost)']);
      expect(p.join()).not.toContain(value);
    }
  });

  it('CORS entries must be bare origins (no trailing slash or path)', () => {
    for (const value of ['https://muzikhub.vercel.app/', 'https://muzikhub.vercel.app/app']) {
      expect(problems({ ...prod, CORS_ORIGINS: value })).toEqual([
        'CORS_ORIGINS: each entry must be an origin only: https://host, no path and no trailing slash',
      ]);
    }
    expect(problems({ ...prod, CORS_ORIGINS: 'https://muzikhub.vercel.app, https://www.muzikhub.test' })).toEqual([]);
  });

  it('development keeps its localhost defaults', () => {
    expect(
      problems({ ...prod, NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:5173', BETTER_AUTH_URL: 'http://localhost:4000' }),
    ).toEqual([]);
  });
});

describe('PROXY_SHARED_SECRET', () => {
  it('is optional (setup A, or local development)', () => {
    const r = parseEnvironment(prod);
    expect(r.success && r.data.PROXY_SHARED_SECRET).toBeUndefined();
  });
  it('must be long and printable, without echoing it', () => {
    const short = 'abc123';
    const p = problems({ ...prod, PROXY_SHARED_SECRET: short });
    expect(p).toEqual(['PROXY_SHARED_SECRET: PROXY_SHARED_SECRET must be at least 32 characters (openssl rand -hex 32)']);
    expect(p.join()).not.toContain(short);
    expect(problems({ ...prod, PROXY_SHARED_SECRET: `${'a'.repeat(32)} b` })).toHaveLength(1);
    expect(problems({ ...prod, PROXY_SHARED_SECRET: 'f'.repeat(64) })).toEqual([]);
  });
});
