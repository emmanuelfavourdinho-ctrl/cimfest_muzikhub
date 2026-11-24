# ADR 0001 — Password storage: scrypt at the OWASP minimum, rehash on sign-in

- **Status:** accepted (owner decision C1, 2026-11-24)
- **Context:** Better Auth's default scrypt uses N=2^14, r=16, p=1, about 32 MiB per hash. The OWASP Password Storage Cheat Sheet's scrypt minimum is **N=2^17 (128 MiB), r=8, p=1**, so the default is below it. The owner chose to keep scrypt rather than switch to Argon2id now, and to make a later move possible without forcing password resets.

## Decision

- `apps/api/src/lib/password.ts` replaces Better Auth's hasher (`emailAndPassword.password`):
  - **Parameters:** scrypt N=2^17, r=8, p=1, 64-byte key, 16-byte random salt per hash, NFKC-normalised input, constant-time comparison.
  - **Stored format:** self-describing, `$scrypt$ln=17,r=8,p=1$<salt>$<key>` (base64url). Parameters can change later without breaking stored hashes.
- **Legacy hashes** (`<salt hex>:<key hex>`) still verify. After a **successful** verification, any hash below the current parameters is re-hashed in the background, and exactly that stored value is replaced (salts make every hash unique). Wrong passwords never trigger it.
- **Concurrency cap:** at most **2** hashes run at once. Each needs 128 MiB, which bounds the spike to 256 MiB.
- **Tests:** the suite uses N=2^12 (same format, same code path) to stay fast. One test runs the production parameters.

## Measured (this machine, 8 cores, Node 26)

- One hash: **341 ms**; one verify: **340 ms**.
- Four simultaneous sign-ins: **719 ms** total (two at a time).
- Peak process memory during that burst: **328 MiB**.

## Consequences

- Sign-in costs about 0.35 s of CPU per attempt, which also slows online guessing (on top of Better Auth's rate limits).
- **Memory:** a 512 MiB instance fits but with little headroom. Use ≥ 1 GiB in production, or lower `MAX_CONCURRENT` to 1.
- **Moving to Argon2id later:** add an `$argon2id$` branch in `verifyPassword`, switch `hashPassword`, and the same rehash-on-sign-in path upgrades users gradually. Accounts that never sign in keep the older hash; to retire it entirely, force a reset for those accounts at a chosen date.

## Tests

`apps/api/src/lib/password.test.ts`:
- production parameters and format;
- salting and NFKC normalisation;
- tampered and absurd-cost hashes rejected;
- the Better Auth legacy format verifies and is flagged;
- upgrade on sign-in;
- no upgrade on a wrong password;
- new sign-ups stored in the new format.
