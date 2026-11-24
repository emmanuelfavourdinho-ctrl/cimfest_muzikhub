/**
 * Read-only database connection check.
 *
 *   npm run db:check -w @muzikhub/api                       # uses apps/api/.env.supabase
 *   npm run db:check -w @muzikhub/api -- --env .env.other
 *
 * Reads DATABASE_URL from the given file only (not from apps/api/.env or the shell),
 * requires sslmode=verify-full with an existing CA certificate, and then:
 *   1. connects with the WRONG CA and expects the TLS handshake to be refused;
 *   2. connects with the configured CA, confirms the certificate was verified, and runs
 *      fixed SELECTs inside a READ ONLY transaction that is rolled back.
 * Prints no user name, password, project reference or full host. Never migrates or writes.
 * Exit code 0 only when every check passes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { API_ROOT, hostSuffix, resolveDatabaseUrl } from '../config/database.js';
import { readOnlyProbe, redact, tlsDetails, wrongCaIsRejected } from '../lib/db-check.js';

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);
const fail = (s: string): never => {
  bad(s);
  process.exit(1);
};

const args = process.argv.slice(2);
const flag = args.indexOf('--env');
const envArg = flag >= 0 ? args[flag + 1] : '.env.supabase';
if (!envArg) fail('--env needs a file name');
const envFile = isAbsolute(envArg!) ? envArg! : resolve(API_ROOT, envArg!);

console.log(`Database check (read-only) — ${envArg}`);
if (!existsSync(envFile)) fail(`${envFile} does not exist. See docs/ARCHITECTURE.md §7b for how to create it.`);

// The file holds a password: refuse to use one Git would commit.
try {
  execFileSync('git', ['check-ignore', '-q', envFile], { cwd: API_ROOT, stdio: 'ignore' });
  ok(`${envArg} is ignored by Git`);
} catch {
  fail(`${envArg} is NOT ignored by Git (or Git is unavailable). Refusing to read credentials from it.`);
}

const raw = parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL?.trim();
if (!raw) fail(`DATABASE_URL is not set in ${envArg}`);

const db = resolveDatabaseUrl(raw!, { requireVerifiedTls: true });
if (!db.ok) {
  for (const p of db.problems) bad(`DATABASE_URL ${p}`);
  process.exit(1);
}
ok(`sslmode=verify-full, CA certificate ${db.caPath!.replace(`${API_ROOT}/`, '')}`);
ok(`host …${hostSuffix(db.host)}, port ${new URL(db.url).port || '5432'}`);

// 1. Wrong CA must be refused.
const wrong = await wrongCaIsRejected(db.url);
if (wrong.rejected) ok(`a connection with the wrong CA is refused (${wrong.code})`);
else if ('inconclusive' in wrong)
  fail(`wrong-CA test was inconclusive: ${redact(String((wrong.error as Error)?.message ?? wrong.error), db.url)}`);
else fail('a connection with the WRONG CA was accepted — certificate verification is not working. Stopping.');

// 2. Real connection, verified, read-only.
const client = new pg.Client({ connectionString: db.url, connectionTimeoutMillis: 15_000, application_name: 'muzikhub-db-check' });
try {
  await client.connect();
} catch (error) {
  fail(
    `could not connect: ${redact(String((error as Error).message), db.url)}${(error as { code?: string }).code ? ` (${(error as { code?: string }).code})` : ''}`,
  );
}
try {
  const tls = tlsDetails(client);
  if (!tls.encrypted || !tls.authorized) fail('the connection is not an encrypted, certificate-verified TLS connection');
  if (tls.encrypted) ok(`TLS ${tls.protocol} (${tls.cipher}), certificate verified, issued by ${tls.issuer}, valid until ${tls.validTo}`);

  const r = await readOnlyProbe(client);
  ok(`read-only transaction confirmed (rolled back afterwards)`);
  ok(`PostgreSQL ${r.serverVersion}, database "${r.database}", ${r.publicTables} table(s) in schema public`);
  const m = r.migrations;
  if (!m.table) {
    console.log(`  • no _prisma_migrations table: no migrations applied yet (${m.local} in the repository). Nothing was changed.`);
  } else {
    console.log(
      `  • migrations: ${m.applied} applied, ${m.pending.length} pending, ${m.failed.length} failed, ${m.unknown.length} not in this repository`,
    );
    for (const p of m.pending) console.log(`      pending: ${p}`);
    for (const f of m.failed) console.log(`      FAILED:  ${f}`);
    for (const u of m.unknown) console.log(`      unknown: ${u}`);
  }
  console.log('All checks passed. No data or schema was modified.');
} catch (error) {
  fail(redact(String((error as Error).message), db.url));
} finally {
  await client.end().catch(() => {});
}
