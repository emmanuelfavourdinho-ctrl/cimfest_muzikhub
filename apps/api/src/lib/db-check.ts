import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates, type TLSSocket } from 'node:tls';
import pg from 'pg';
import { API_ROOT } from '../config/database.js';

/**
 * Read-only connection check used by `npm run db:check`.
 * Everything runs inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`, and only fixed SELECT
 * statements are sent, so the check cannot change database contents or schema.
 */

export interface ProbeResult {
  readOnly: true;
  serverVersion: string;
  database: string;
  publicTables: number;
  migrations:
    | { table: false; local: number }
    | { table: true; local: number; applied: number; pending: string[]; failed: string[]; unknown: string[] };
}

/** Migration folder names in apps/api/prisma/migrations, oldest first. */
export function localMigrations(root = API_ROOT) {
  return readdirSync(join(root, 'prisma/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export async function readOnlyProbe(client: pg.Client, local: string[] = localMigrations()): Promise<ProbeResult> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const ro = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
    if (ro.rows[0]?.transaction_read_only !== 'on') throw new Error('The server did not open a read-only transaction; stopping without running any queries.');
    await client.query("SET LOCAL statement_timeout = '10s'");

    const info = await client.query<{ version: string; database: string; tables: number }>(
      `SELECT current_setting('server_version') AS version,
              current_database() AS database,
              (SELECT count(*)::int FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables`,
    );
    const row = info.rows[0]!;
    const present = await client.query<{ present: boolean }>(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);

    let migrations: ProbeResult['migrations'] = { table: false, local: local.length };
    if (present.rows[0]?.present) {
      const rows = (
        await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
          'SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations',
        )
      ).rows;
      const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
      migrations = {
        table: true,
        local: local.length,
        applied: applied.size,
        pending: local.filter((m) => !applied.has(m)),
        failed: rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
        unknown: [...applied].filter((m) => !local.includes(m)),
      };
    }
    return { readOnly: true, serverVersion: row.version, database: row.database, publicTables: row.tables, migrations };
  } finally {
    await client.query('ROLLBACK');
  }
}

/** TLS details of the client's own connection (to the pooler, for Supabase). */
export function tlsDetails(client: pg.Client) {
  const stream = (client as unknown as { connection: { stream: TLSSocket } }).connection.stream;
  if (typeof stream.getProtocol !== 'function') return { encrypted: false as const };
  const peer = stream.getPeerCertificate();
  return {
    encrypted: true as const,
    authorized: stream.authorized,
    protocol: stream.getProtocol(),
    cipher: stream.getCipher()?.name,
    issuer: [peer.issuer?.O, peer.issuer?.CN].filter(Boolean).join(' / '),
    validTo: peer.valid_to,
  };
}

const TLS_VERIFY_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_SIGNATURE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** True when an error is the TLS layer refusing the server's certificate. */
export function isCertificateRejection(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code !== undefined && TLS_VERIFY_CODES.has(code);
}

/**
 * Tries to connect with a CA bundle that cannot have signed the server's certificate
 * (Node's public roots, which do not include Supabase's private root CA). Passing means the
 * connection was refused at the TLS handshake, before any credentials were sent.
 */
export async function wrongCaIsRejected(verifiedUrl: string, timeoutMs = 15_000) {
  const dir = mkdtempSync(join(tmpdir(), 'muzikhub-wrong-ca-'));
  try {
    const caFile = join(dir, 'public-roots.pem');
    writeFileSync(caFile, rootCertificates.join('\n'));
    const url = new URL(verifiedUrl);
    url.searchParams.set('sslrootcert', caFile);
    const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: timeoutMs });
    try {
      await client.connect();
      return { rejected: false as const };
    } catch (error) {
      return isCertificateRejection(error)
        ? { rejected: true as const, code: (error as { code: string }).code }
        : { rejected: false as const, inconclusive: true as const, error };
    } finally {
      await client.end().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Removes the user name, password and host from an error message before it is printed. */
export function redact(message: string, url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '[redacted]';
  }
  const secrets = [u.password, decodeURIComponent(u.password), u.username, decodeURIComponent(u.username), u.hostname]
    .concat(decodeURIComponent(u.username).split('.').slice(1)) // Supabase project reference
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length);
  let out = message;
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out;
}
