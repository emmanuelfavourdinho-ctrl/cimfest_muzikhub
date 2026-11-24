import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * apps/api — the directory relative certificate paths are resolved against, so
 * `sslrootcert=certs/prod-supabase.crt` means the same file whatever the process's
 * working directory is. (src/config → ../.. and dist/config → ../.. both land here.)
 */
export const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Connection-string parameters that node-postgres honours and that could switch off
 * or loosen certificate verification. Refused outright for remote databases.
 */
const WEAKENING_PARAMS = ['ssl', 'uselibpqcompat', 'sslaccept', 'sslnegotiation'];

export type DatabaseUrlResult =
  | { ok: true; url: string; local: boolean; caPath: string | null; host: string }
  | { ok: false; problems: string[] };

/**
 * Checks a PostgreSQL URL and returns the URL the app should actually use.
 *
 * - Local databases (localhost / 127.0.0.1 / ::1) without `sslrootcert` are passed through
 *   unchanged, so the Docker development and test databases keep working exactly as before.
 * - Any other host must use `sslmode=verify-full` (certificate chain + hostname) with an
 *   `sslrootcert` that exists and is a PEM certificate. Nothing is silently downgraded:
 *   a missing or invalid setting is an error, never a fallback to weaker TLS.
 * - A relative `sslrootcert` is resolved against apps/api and rewritten as an absolute path.
 *
 * Problems never include the URL, user name or password.
 */
export function resolveDatabaseUrl(
  raw: string,
  options: { requireVerifiedTls?: boolean; root?: string } = {},
): DatabaseUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problems: ['is not a valid URL'] };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return { ok: false, problems: ['must start with postgresql://'] };

  const local = LOCAL_HOSTS.has(url.hostname);
  // A local URL that names a CA certificate gets the same rules (and path resolution) as a remote one.
  if (local && !options.requireVerifiedTls && !url.searchParams.has('sslrootcert')) {
    return { ok: true, url: raw, local, caPath: null, host: url.hostname };
  }

  const problems: string[] = [];
  const mode = url.searchParams.get('sslmode');
  if (mode !== 'verify-full') {
    problems.push(`must use sslmode=verify-full for a ${local ? 'verified' : 'non-local'} connection (found ${mode ? `sslmode=${mode}` : 'no sslmode'})`);
  }
  for (const param of WEAKENING_PARAMS) {
    if (url.searchParams.has(param)) problems.push(`must not set "${param}" (it can weaken certificate verification)`);
  }

  const ca = url.searchParams.get('sslrootcert');
  let caPath: string | null = null;
  if (!ca) {
    problems.push('must set sslrootcert to the database CA certificate, e.g. sslrootcert=certs/prod-supabase.crt');
  } else {
    caPath = isAbsolute(ca) ? ca : resolve(options.root ?? API_ROOT, ca);
    if (!existsSync(caPath)) {
      problems.push(`sslrootcert file not found: ${caPath}`);
    } else {
      const pem = readFileSync(caPath, 'utf8');
      if (!pem.includes('-----BEGIN CERTIFICATE-----')) problems.push(`sslrootcert is not a PEM certificate: ${caPath}`);
      if (/PRIVATE KEY-----/.test(pem)) problems.push(`sslrootcert contains a private key and must not be used: ${caPath}`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  url.searchParams.set('sslrootcert', caPath!);
  return { ok: true, url: url.toString(), local, caPath, host: url.hostname };
}

/** The last labels of a host name — enough to recognise it, without the project reference. */
export function hostSuffix(host: string) {
  if (LOCAL_HOSTS.has(host) || /^[\d.]+$/.test(host)) return host;
  return host.split('.').slice(-3).join('.');
}
