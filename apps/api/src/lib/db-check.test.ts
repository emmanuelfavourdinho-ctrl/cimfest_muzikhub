import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCertificateRejection, localMigrations, readOnlyProbe, redact } from './db-check.js';

// Runs against the local muzikhub_test database only (set by vitest.config.ts).
const url = process.env.DATABASE_URL!;

describe('db:check read-only probe (local test database)', () => {
  let client: pg.Client;
  beforeEach(async () => {
    expect(url).toContain('muzikhub_test');
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });
  afterEach(async () => {
    await client.end();
  });

  it('reports the server and migration state', async () => {
    const r = await readOnlyProbe(client);
    expect(r.readOnly).toBe(true);
    expect(r.database).toBe('muzikhub_test');
    expect(r.publicTables).toBeGreaterThan(5);
    expect(r.migrations).toMatchObject({ table: true, local: localMigrations().length, pending: [], failed: [], unknown: [] });
  });

  it('sends only read-only statements, inside a READ ONLY transaction that is rolled back', async () => {
    const sent: string[] = [];
    const original = client.query.bind(client);
    (client as { query: unknown }).query = (text: string, ...rest: unknown[]) => {
      sent.push(text.trim());
      return (original as (...a: unknown[]) => unknown)(text, ...rest);
    };
    await readOnlyProbe(client);
    expect(sent[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sent.at(-1)).toBe('ROLLBACK');
    for (const s of sent.slice(1, -1)) expect(s).toMatch(/^(SHOW transaction_read_only|SET LOCAL statement_timeout|SELECT )/);
    expect((await original('SELECT 1 AS one')).rows[0].one).toBe(1); // not left inside a transaction
  });

  it('PostgreSQL itself rejects writes and DDL in that transaction mode', async () => {
    for (const statement of [
      `INSERT INTO "user" (id, name, email) VALUES ('ro-probe', 'x', 'x@example.test')`,
      'CREATE TABLE db_check_should_not_exist (id int)',
      `UPDATE "user" SET name = name`,
      'DELETE FROM report',
    ]) {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await expect(client.query(statement)).rejects.toMatchObject({ code: '25006' }); // read_only_sql_transaction
      await client.query('ROLLBACK');
    }
    const leftovers = await client.query(
      `SELECT to_regclass('public.db_check_should_not_exist') AS t, (SELECT count(*)::int FROM "user" WHERE id = 'ro-probe') AS u`,
    );
    expect(leftovers.rows[0]).toEqual({ t: null, u: 0 });
  });
});

describe('db:check helpers', () => {
  it('redacts user name, password, host and project reference', () => {
    const u = 'postgresql://postgres.abcdefprojectref:s3cr%40t@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
    const msg = 'password authentication failed for user "postgres.abcdefprojectref" at aws-0-eu-west-1.pooler.supabase.com (s3cr@t)';
    const out = redact(msg, u);
    for (const secret of ['abcdefprojectref', 's3cr@t', 'aws-0-eu-west-1', 'postgres.abc']) expect(out).not.toContain(secret);
  });

  it('recognises only certificate failures as a wrong-CA rejection', () => {
    expect(isCertificateRejection(Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }))).toBe(true);
    expect(isCertificateRejection(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }))).toBe(true);
    expect(isCertificateRejection(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(isCertificateRejection(Object.assign(new Error('x'), { code: '28P01' }))).toBe(false);
  });
});
