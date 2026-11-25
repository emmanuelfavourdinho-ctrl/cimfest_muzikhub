import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password storage (ADR 0001). scrypt at the OWASP Password Storage Cheat Sheet minimum:
 * N = 2^17 (128 MiB), r = 8, p = 1, 64-byte key, 16-byte random salt, NFKC-normalised input.
 *
 * Stored format (PHC-style, self-describing so parameters can change without breaking old
 * hashes):  $scrypt$ln=17,r=8,p=1$<salt base64url>$<key base64url>
 *
 * Better Auth's default format (`<salt hex>:<key hex>`, N = 2^14, r = 16, p = 1, below the
 * OWASP minimum) still verifies. After a successful verification, any hash that isn't at the
 * current parameters is re-hashed in place (`onRehash`), so nobody is forced to reset. A
 * future move to Argon2id adds one more prefix here and reuses the same path.
 */
type Params = { ln: number; r: number; p: number };

/** OWASP minimum. Tests use a cheaper profile so the suite stays fast; the format is identical. */
export const PRODUCTION_PARAMS: Params = { ln: 17, r: 8, p: 1 };
const TEST_PARAMS: Params = { ln: 12, r: 8, p: 1 };
export const CURRENT_PARAMS: Params = process.env.NODE_ENV === 'test' ? TEST_PARAMS : PRODUCTION_PARAMS;

const KEY_LEN = 64;
const LEGACY = { N: 16384, r: 16, p: 1, keyLen: 64 }; // Better Auth default

/**
 * At most two hashes run at once: each needs 128 MiB, so this caps the memory spike at
 * 256 MiB however many people sign in together (small hosting instances have 512 MiB).
 */
const MAX_CONCURRENT = 2;
let running = 0;
const queue: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    queue.shift()?.();
  }
}

function derive(password: string, salt: Buffer | string, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return withSlot(
    () =>
      new Promise((resolve, reject) =>
        scryptCb(password.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
      ),
  );
}

const scryptOpts = ({ ln, r, p }: Params): ScryptOptions => ({ N: 2 ** ln, r, p, maxmem: 2 * 128 * 2 ** ln * r * p + 1024 * 1024 });

export async function hashPassword(password: string, params: Params = CURRENT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LEN, scryptOpts(params));
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

const PHC = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;
const LEGACY_FORMAT = /^([0-9a-f]{32}):([0-9a-f]{128})$/;

export type ParsedHash = { kind: 'scrypt'; params: Params } | { kind: 'legacy' } | { kind: 'unknown' };
export function parseHash(stored: string): ParsedHash {
  const m = PHC.exec(stored);
  if (m) return { kind: 'scrypt', params: { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) } };
  if (LEGACY_FORMAT.test(stored)) return { kind: 'legacy' };
  return { kind: 'unknown' };
}

/** True when the stored hash is weaker than (or different from) the current parameters. */
export function needsRehash(stored: string, params: Params = CURRENT_PARAMS): boolean {
  const parsed = parseHash(stored);
  if (parsed.kind !== 'scrypt') return true;
  return parsed.params.ln < params.ln || parsed.params.r !== params.r || parsed.params.p !== params.p;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (m) {
    const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
    if (params.ln < 10 || params.ln > 20) return false; // refuse absurd stored parameters
    const expected = Buffer.from(m[5]!, 'base64url');
    const key = await derive(password, Buffer.from(m[4]!, 'base64url'), expected.length, scryptOpts(params));
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
  const legacy = LEGACY_FORMAT.exec(stored);
  if (legacy) {
    // Better Auth used the hex salt *string* as the salt.
    const expected = Buffer.from(legacy[2]!, 'hex');
    const key = await derive(password, legacy[1]!, LEGACY.keyLen, {
      N: LEGACY.N,
      r: LEGACY.r,
      p: LEGACY.p,
      maxmem: 2 * 128 * LEGACY.N * LEGACY.r,
    });
    return timingSafeEqual(key, expected);
  }
  return false;
}

/**
 * Better Auth hooks. `verify` also upgrades a correct-but-outdated hash: it replaces exactly
 * that stored value (salts make every hash unique), in the background, without delaying sign-in.
 */
export function betterAuthPassword(onRehash: (oldHash: string, newHash: string) => Promise<unknown>) {
  return {
    hash: (password: string) => hashPassword(password),
    verify: async ({ hash, password }: { hash: string; password: string }) => {
      const ok = await verifyPassword(hash, password);
      if (ok && needsRehash(hash)) {
        void hashPassword(password)
          .then((next) => onRehash(hash, next))
          .catch((error: unknown) => console.error('password rehash failed', error));
      }
      return ok;
    },
  };
}
