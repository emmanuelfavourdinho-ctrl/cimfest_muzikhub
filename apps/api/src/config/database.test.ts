import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROOT, hostSuffix, resolveDatabaseUrl } from './database.js';
import { parseEnvironment } from './env.js';

// Fake credentials only — never real ones.
const REMOTE = 'postgresql://postgres.abcdefprojectref:s3cr%40t-pass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
const CA = 'certs/prod-supabase.crt';

function problems(url: string) {
  const r = resolveDatabaseUrl(url);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.problems;
}

describe('resolveDatabaseUrl', () => {
  it('passes local Docker URLs through unchanged', () => {
    const local = 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub?schema=public';
    expect(resolveDatabaseUrl(local)).toMatchObject({ ok: true, url: local, local: true, caPath: null });
    expect(resolveDatabaseUrl('postgresql://u:p@127.0.0.1:5435/db')).toMatchObject({ ok: true, local: true });
  });

  it('a local URL that names a CA gets the same rules and an absolute path', () => {
    const r = resolveDatabaseUrl(`postgresql://u:p@localhost:5499/db?sslmode=verify-full&sslrootcert=${CA}`);
    expect(r).toMatchObject({ ok: true, local: true, caPath: join(API_ROOT, CA) });
    expect(problems(`postgresql://u:p@localhost:5499/db?sslmode=require&sslrootcert=${CA}`).join()).toMatch(/found sslmode=require/);
  });

  it('refuses a remote database without verified TLS — nothing is silently downgraded', () => {
    expect(problems(REMOTE).join()).toMatch(/sslmode=verify-full.*no sslmode/);
    for (const mode of ['disable', 'prefer', 'require', 'verify-ca', 'no-verify']) {
      expect(problems(`${REMOTE}?sslmode=${mode}&sslrootcert=${CA}`).join()).toContain(`found sslmode=${mode}`);
    }
  });

  it('requires an existing PEM CA certificate', () => {
    expect(problems(`${REMOTE}?sslmode=verify-full`).join()).toMatch(/must set sslrootcert/);
    expect(problems(`${REMOTE}?sslmode=verify-full&sslrootcert=certs/missing.crt`).join()).toMatch(/not found/);
    const dir = mkdtempSync(join(tmpdir(), 'mh-ca-'));
    writeFileSync(join(dir, 'not-pem.crt'), 'hello');
    writeFileSync(
      join(dir, 'with-key.crt'),
      '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
    );
    expect(problems(`${REMOTE}?sslmode=verify-full&sslrootcert=${join(dir, 'not-pem.crt')}`).join()).toMatch(/not a PEM certificate/);
    expect(problems(`${REMOTE}?sslmode=verify-full&sslrootcert=${join(dir, 'with-key.crt')}`).join()).toMatch(/private key/);
  });

  it('refuses parameters that could weaken verification', () => {
    for (const p of ['ssl=0', 'uselibpqcompat=true', 'sslaccept=accept_invalid_certs', 'sslnegotiation=direct']) {
      expect(problems(`${REMOTE}?sslmode=verify-full&sslrootcert=${CA}&${p}`).join()).toContain(`"${p.split('=')[0]}"`);
    }
  });

  it('resolves a relative certificate against apps/api, whatever the working directory', () => {
    const r = resolveDatabaseUrl(`${REMOTE}?sslmode=verify-full&sslrootcert=${CA}`);
    expect(r).toMatchObject({ ok: true, local: false, caPath: join(API_ROOT, CA) });
    expect(API_ROOT.endsWith('/apps/api')).toBe(true);
    const u = new URL((r as { url: string }).url);
    expect(u.searchParams.get('sslrootcert')).toBe(join(API_ROOT, CA));
    expect(u.searchParams.get('sslmode')).toBe('verify-full');
    expect(u.password).toBe('s3cr%40t-pass'); // credentials untouched
  });

  it('never puts credentials in problem messages', () => {
    const text = problems(`${REMOTE}?sslmode=require`).join(' ');
    for (const secret of ['s3cr', 'abcdefprojectref', 'postgres.', 'aws-0-eu-west-1']) expect(text).not.toContain(secret);
  });

  it('hostSuffix hides the project-specific part', () => {
    expect(hostSuffix('aws-0-eu-west-1.pooler.supabase.com')).toBe('pooler.supabase.com');
    expect(hostSuffix('db.abcdefprojectref.supabase.co')).toBe('abcdefprojectref.supabase.co'.split('.').slice(-3).join('.'));
  });
});

describe('environment: database settings', () => {
  const base = { BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'http://localhost:4000', NODE_ENV: 'development' };

  it('the API refuses to start with an unverified remote database', () => {
    const r = parseEnvironment({ ...base, DATABASE_URL: `${REMOTE}?sslmode=require` });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain('DATABASE_URL');
    expect(JSON.stringify(r.error!.issues)).not.toContain('s3cr');
  });

  it('accepts a verified remote database and hands the app an absolute certificate path', () => {
    const r = parseEnvironment({ ...base, DATABASE_URL: `${REMOTE}?sslmode=verify-full&sslrootcert=${CA}` });
    expect(r.success).toBe(true);
    expect(new URL(r.data!.DATABASE_URL).searchParams.get('sslrootcert')).toBe(join(API_ROOT, CA));
  });

  it('DATABASE_POOL_MAX defaults to 5 and can be configured', () => {
    const local = 'postgresql://u:p@localhost:5435/db';
    expect(parseEnvironment({ ...base, DATABASE_URL: local }).data?.DATABASE_POOL_MAX).toBe(5);
    expect(parseEnvironment({ ...base, DATABASE_URL: local, DATABASE_POOL_MAX: '12' }).data?.DATABASE_POOL_MAX).toBe(12);
    expect(parseEnvironment({ ...base, DATABASE_URL: local, DATABASE_POOL_MAX: '0' }).success).toBe(false);
    expect(parseEnvironment({ ...base, DATABASE_URL: local, DATABASE_POOL_MAX: 'many' }).success).toBe(false);
  });
});
