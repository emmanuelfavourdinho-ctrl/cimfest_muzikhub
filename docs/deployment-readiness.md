# Deployment readiness — audit of 2026-11-25

Audit of commit `b44b1c7` (branch `feat/catalogue-entitlements`). Read-only: nothing was deployed, no
production service was contacted, no migration was applied, and no secret file was opened.

Target: **Vercel** (web) · **Render** (API) · **Supabase PostgreSQL** · **Cloudinary** · **Resend** · Notch Pay (stays off).

Legend: **BLOCKER** = the deployed app won't work, or won't start · **REQUIRED** = fix before real users ·
**OPTIONAL** = can follow after launch.

---

## 1. The one architectural decision needed first: how the browser reaches the API

The session cookie is Better Auth's default: host-only, `HttpOnly`, `Secure` on https, and **`SameSite=Lax`**.
`vercel.app` and `onrender.com` are both on the Public Suffix List, so `muzikhub.vercel.app` and
`muzikhub-api.onrender.com` count as **different sites**. If the browser calls Render directly
(`VITE_API_URL=https://…onrender.com`), sign-in returns 200 but the cookie is never sent back on later
`fetch` calls, so the user is never signed in. `SameSite=None` isn't a fix: Safari, Firefox and Chrome
block or partition third-party cookies.

There are two working options:

| | **A. Custom domain (recommended)** | **B. Vercel rewrite (no domain needed)** |
|---|---|---|
| Setup | `app.<domain>` → Vercel, `api.<domain>` → Render. `VITE_API_URL=https://api.<domain>` | `vercel.json` rewrites `/api/:path*` → `https://<render>.onrender.com/api/:path*`. `VITE_API_URL` unset |
| Cookies | Set by `api.<domain>`; same-site with `app.<domain>`, so Lax cookies are sent. Already CORS + credentials | First-party on the Vercel origin |
| Real-time (Socket.IO) | WebSocket straight to Render: **works** | **Vercel rewrites don't proxy WebSockets.** The client is configured `transports: ['websocket', 'polling']` and engine.io-client 6.6.8 does **not** fall back (`tryAllTransports` is false). Live messages and notifications stop until a code change (polling first, or `tryAllTransports: true`), and long-polling through the proxy then needs testing |
| Client IPs | One proxy hop (Render): `trust proxy 1` and Better Auth's IP detection are correct | Two hops (Vercel → Render). `X-Forwarded-For` has two entries, so **Better Auth can't resolve an IP and puts every visitor in one shared bucket**: 5 sign-ups per minute and 10 sign-ins per minute for the whole site. Needs `advanced.ipAddress` configuration and verification on a preview deployment. Express `req.ip` becomes Vercel's edge IP |
| Needs | A domain and DNS access | Code changes (realtime transport, Better Auth IP config), then verification |

**Update 2026-11-25: no custom domain, so option B applies** (with its code changes). **Status: BLOCKER until those changes are made.** `docs/ARCHITECTURE.md` §7 recommended B, but this audit found
the two problems above. A avoids both and is the more robust choice. A domain is also needed for Resend (§5).

---

## 2. Findings

| # | Area | Finding | Class |
|---|---|---|---|
| 1 | Routing | **No SPA fallback.** There's no `vercel.json`, so deep links (`/communities`, `/u/…`, a reload on any app page) return Vercel's 404. Needs `rewrites: [{ "source": "/((?!api/).*)", "destination": "/index.html" }]` | **BLOCKER** |
| 2 | Cookies / API URL | Cross-site cookie problem (§1). Choose A or B | **BLOCKER** |
| 3 | Email | **Update 2026-11-25:** there's no custom domain, so no Resend sending domain. The API now supports **restricted-email mode** (`EMAIL_TRANSPORT=disabled` + `ALLOW_EMAIL_DISABLED_IN_PRODUCTION=true`, ARCHITECTURE §5d): it starts without Resend credentials, refuses password reset and verification resends with 503 `EMAIL_UNAVAILABLE`, and the web app says so. Consequences: no password recovery, no email confirmation, so **no organisers and no first administrator** through the normal flows (see the attestation note in IMPLEMENTATION_STATUS) | REQUIRED (choose restricted mode) |
| 4 | Database | **12 migrations are pending on Supabase** (§3). The API's tables don't exist there yet | **BLOCKER** (awaiting your confirmation) |
| 5 | Render build | `typescript`, `prisma` and `tsx` are **devDependencies**. If `NODE_ENV=production` is set (it must be), `npm ci` skips them and the build fails. Build command must use `npm ci --include=dev` | **BLOCKER** (configuration only, §6) |
| 6 | Monorepo builds | `@muzikhub/shared` must be built before web and API (`dist/` is git-ignored). Both build commands must build it first (§6) | **BLOCKER** (configuration only) |
| 7 | Environment defaults | `CORS_ORIGINS`, `WEB_APP_URL` default to `http://localhost:5173` and nothing refuses that in production. A missing variable gives a running API whose email links point to localhost and which rejects every browser write (`CROSS_ORIGIN_REJECTED`). Recommend a startup check for https, non-localhost values in production | **REQUIRED** |
| 8 | Real-time | Works only with option A, or B plus a client change (§1) | **REQUIRED** (with B) |
| 9 | Rate limits behind Vercel | Shared IP bucket with option B (§1) | **REQUIRED** (with B) |
| 10 | Security headers (web) | The API sends Helmet headers. **The web app sends none** (no CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`). Add `headers` in `vercel.json`. A CSP must allow Cloudinary (`res.cloudinary.com`, `api.cloudinary.com` for uploads), the API origin and `wss:` for option A | **REQUIRED** |
| 11 | Media | Cloudinary is optional at startup; without credentials every upload returns 503 (an honest failure). For launch, set `CLOUDINARY_*`. Production assets go under `muzikhub/production/…`, separate from dev | **REQUIRED** for media; the app runs without it |
| 12 | First admin | No admin exists in production. Run `admin:grant-initial` against Supabase once an account is registered (§6.5) | **REQUIRED** |
| 13 | Render free plan | Sleeps after 15 min idle: about a 1-minute cold start, WebSockets drop, background jobs (outbox emails, suspension expiry, sweeps) pause while asleep. Fine for a demo; use a paid instance for launch | **REQUIRED** for launch / OK for demo |
| 14 | In-memory state | Rate limits (app and Better Auth), Socket.IO rooms and the per-recipient email limit are per process: correct for **one** instance, reset on restart. Keep Render at 1 instance (no autoscaling) until a shared store exists | **REQUIRED**: keep 1 instance |
| 15 | Graceful shutdown | `SIGTERM` handler calls `server.close()` but not `closeRealtime()`. Open WebSockets keep it pending, so every deploy ends with the 10 s forced `exit(1)`. Harmless (DB pool is dropped by exit) but noisy | OPTIONAL |
| 16 | Dependencies | `npm audit --omit=dev`: **no critical**. 3 high findings, all `effect` (ReDoS) through the Prisma CLI's config loader. It runs only on our own trusted config, not on requests. The fix needs a Prisma downgrade, so leave it as is and watch for a Prisma patch | OPTIONAL (documented) |
| 17 | Payments | Safe as-is. Production defaults to `PAYMENTS_MODE=off` and `PAYMENTS_PROVIDER=notchpay`; live is refused in code (`LIVE_PAYMENTS_APPROVED=false`); sandbox in production is refused unless explicitly allowed; the TEST PROVIDER is refused in production; the webhook route returns 404 when payments are off. Leave all `NOTCHPAY_*` unset | ✅ nothing to do |
| 18 | Catalogue | `/pricing` reads the service catalogue. Supabase is empty, so plans show as unavailable. `catalogue:seed` would insert inactive rows, which is seeding production data. Your decision; not needed for launch | OPTIONAL (owner) |
| 19 | Health | `GET /api/v1/health` checks the database: 200 when healthy, 503 if not. Use it as Render's health check | ✅ |
| 20 | Port / host | `app.listen(env.PORT)` on all interfaces; Render's `PORT` is honoured | ✅ |
| 21 | TLS to Supabase | Runtime connection requires `sslmode=verify-full` with the committed CA (`apps/api/certs/prod-supabase.crt`, valid to 2031); weaker settings refuse to start | ✅ |
| 22 | Frontend bundle | Production `dist/` scanned: no keys, database URLs, Notch Pay, Resend or Cloudinary secrets, no `localhost:4000`, no `/dev/payments` (dev routes are compiled out). Only `VITE_*` variables reach the browser, and none are secret | ✅ |
| 23 | Auth / CSRF | Better Auth `trustedOrigins` and the `/api/v1` Origin + Fetch-Metadata check both use `CORS_ORIGINS`; `HttpOnly` + `Secure` cookies on https; staff 2FA enforced; sessions revoked on suspend/ban/reset | ✅ (once `CORS_ORIGINS` is right) |
| 24 | Logging / errors | RFC 9457 problem responses; unknown errors are logged server-side and returned as a generic 500; env errors print names, never values. Plain `console` logs (no correlation IDs) | OPTIONAL: structured logs |
| 25 | Preview deployments | Every Vercel preview has its own URL, which isn't in `CORS_ORIGINS`, so previews can't sign in against the production API. Use a separate staging API or accept that previews are visual-only | OPTIONAL |
| 26 | Backups | Supabase Free has no automatic backups and pauses after 1 week of inactivity. Schedule `pg_dump` exports (ARCHITECTURE §7b) | REQUIRED for real users |

---

## 3. Database — migration status (from the repository; Supabase not contacted)

Supabase received the first **5** migrations on 2026-11-24 (owner-approved, recorded in
`docs/ARCHITECTURE.md` §7b and `IMPLEMENTATION_STATUS.md`). Confirm the live state with the read-only
`npm run db:check -w @muzikhub/api` before applying anything.

**Applied:** `init_auth`, `identity_and_profiles`, `media_and_portfolio`, `feed_and_relationships`, `admin_console_foundation`.

**Pending, in order (12):**

| # | Migration | What it does |
|---|---|---|
| 1 | `20261124063925_reliability_idempotency_outbox` | New tables `idempotency_key`, `outbox_event`; 2 enums; 3 indexes |
| 2 | `20261124105856_opportunities` | `user` gains `isOrganiser BOOLEAN NOT NULL DEFAULT false`, `organiserSince`; tables `opportunity`, `opportunity_application`; 3 enums |
| 3 | `20261124125236_billing_catalogue_entitlements` | Tables `service_catalogue`, `subscription`, `promotion`; 5 enums |
| 4 | `20261124135136_payments_lifecycle` | `BillingProduct` gains `TEST_ITEM`; `service_catalogue.testOnly` (default false); tables `payment_order`, `payment_order_event`, `payment_fulfilment`, `payment_webhook_event`; FKs `ON DELETE RESTRICT` (payment records can't be deleted by deleting a user) |
| 5 | `20261124143908_subscriptions_accent_notifications` | `profile.accent` (nullable), `subscription.cancelledAt`; table `notification` |
| 6 | `20261124145507_analytics_daily_counters` | Tables `analytics_seen`, `analytics_daily` |
| 7 | `20261124150259_promotion_targets` | Nullable columns on `payment_order`, `promotion`; 2 CHECK constraints (tables are empty, so they validate instantly) |
| 8 | `20261124162912_safety_blocks_preferences` | Tables `user_block`, `notification_setting`; adds enum values to `MediaPurpose` (2) and `ReportTargetType` (6) |
| 9 | `20261124164507_communities` | 6 tables (community, members, discussions, comments, reactions, follows); 5 enums; partial unique index (one owner) |
| 10 | `20261124171613_direct_messaging` | `profile.messagePolicy NOT NULL DEFAULT 'EVERYONE'`; tables `conversation`, `conversation_participant`, `message` |
| 11 | `20261124172719_collaboration` | 4 tables; 4 enums; partial unique index (one open request per pair) |
| 12 | `20261124204014_competitions` | 7 tables; 5 enums; CHECK constraints on dates, scores, places, slugs, entries |

**Destructive operations: none.** No `DROP`, `RENAME`, `ALTER COLUMN`, `SET NOT NULL` on existing
columns, `DELETE`, `UPDATE`, `TRUNCATE`, functions, triggers, extensions or grants. Every change to an
existing table adds a nullable column or one with a constant default (a metadata-only change in
PostgreSQL 11+). The existing audit-log triggers aren't touched. Supabase's tables are empty (not
seeded), so the new FKs and CHECKs validate instantly with negligible locking.

**One thing to rehearse:** migration 8 adds enum values with `ALTER TYPE … ADD VALUE`, and Prisma runs
each migration in a transaction. This works on the local PostgreSQL 18 dev and test databases. Supabase
runs PostgreSQL 17.12, so rehearse on 17 first, as was done for the first 5.

**Permissions required:** the same role that applied the first 5 (Supabase `postgres` via the session
pooler). It owns the schema, tables and enum types, so it can `CREATE TABLE/TYPE/INDEX`, `ALTER TABLE`
and `ALTER TYPE … ADD VALUE`. No superuser rights are needed.

**Recommended command (only after you confirm):**

```bash
# 0. Rehearsal on PostgreSQL 17 (local, throwaway): replay all 17 migrations
docker run -d --name mh-pg17 -e POSTGRES_PASSWORD=rehearsal -p 5499:5432 postgres:17
cd apps/api
DATABASE_URL='postgresql://postgres:rehearsal@localhost:5499/postgres' npx prisma migrate deploy
docker rm -f mh-pg17

# 1. Read-only check of Supabase (verifies the certificate; shows applied/pending)
npm run db:check -w @muzikhub/api            # reads apps/api/.env.supabase

# 2. Apply. Load the Supabase URL into this shell only, check, then deploy.
cd apps/api
set -a; . ./.env.supabase; set +a            # real env vars take precedence over apps/api/.env
npx prisma migrate status                     # must name the *.pooler.supabase.com host and list 12 pending
npx prisma migrate deploy
npx prisma migrate status                     # expect: "Database schema is up to date"
```

Never `prisma db push`, `migrate dev` or `migrate reset` against Supabase. The Prisma CLI encrypts the
connection but doesn't verify the certificate (documented limitation). Step 1 proves the endpoint first.

---

## 4. Required environment variables

### Render (API) — mandatory

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` (matches CI) |
| `DATABASE_URL` | Supabase **session pooler**, port 5432: `postgresql://postgres.<ref>:<pw>@aws-<n>-<region>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=certs/prod-supabase.crt` (percent-encode the password) |
| `DATABASE_POOL_MAX` | `5` (default; Free pooler allows few clients) |
| `BETTER_AUTH_SECRET` | New value, `openssl rand -base64 32`. Not the dev one |
| `BETTER_AUTH_URL` | A: `https://api.<domain>` · B: `https://<project>.vercel.app` |
| `WEB_APP_URL` | `https://app.<domain>` (A) or `https://<project>.vercel.app` (B) |
| `CORS_ORIGINS` | The exact web origin(s), comma-separated, no trailing slash |
| `EMAIL_TRANSPORT` | `disabled` while there's no verified sender (restricted-email mode); later `resend` |
| `ALLOW_EMAIL_DISABLED_IN_PRODUCTION` | `true` (restricted mode only; remove when switching to Resend) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Only with `EMAIL_TRANSPORT=resend`: the key from Resend and `MuzikHub <no-reply@mail.<verified-domain>>`. No value is invented here |
| `PAYMENTS_MODE` | `off` |

Optional on Render: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
(needed for uploads), `CLOUDINARY_FOLDER=muzikhub`, `REQUIRE_EMAIL_VERIFICATION=false` (keep it false
until the domain is verified). **Leave unset:** `NOTCHPAY_*`, `PAYMENTS_PROVIDER`, `PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION`.

### Vercel (web)

| Variable | Value |
|---|---|
| `VITE_API_URL` | A: `https://api.<domain>` · B: **unset** |
| `VITE_SITE_URL` | Optional: the production origin (enables canonical URL + `sitemap.xml`) |

No secrets go in Vercel; `VITE_*` values are public by design.

---

## 5. External services

| Service | State in the repo | Needed from you |
|---|---|---|
| Supabase | Project exists; 5/17 migrations applied; CA committed; `db:check` works | Approval to apply the 12; regular backups |
| Render | No service yet | Create a Web Service (§6.2) |
| Vercel | No project yet | Create a project (§6.1) |
| Cloudinary | Integration done (signed direct uploads, server-chosen IDs, type/size checks); 503 when unconfigured | Production credentials in Render |
| Resend | Integration done; production refuses to start without it | **Verified sending domain** + `EMAIL_FROM` + API key |
| Notch Pay | Off; live refused in code | Nothing (stays off) |
| TURN | Not used (calls not built) | Nothing |

---

## 6. Deployment checklist

### 6.1 Vercel

- Import the Git repository. **Root Directory:** `.` (repo root, so npm workspaces install).
- Framework preset: **Vite** (or Other).
- **Install command:** `npm ci`
- **Build command:** `npm run build -w @muzikhub/shared && npm run build -w @muzikhub/web`
- **Output directory:** `apps/web/dist`
- Node.js 24.
- Add `vercel.json` at the repo root (not in the repo yet; see §7): SPA fallback, security headers, and for option B the `/api` rewrite.

### 6.2 Render (Web Service)

- Runtime **Node**, root directory: repo root, region close to the Supabase region.
- **Build command:** `npm ci --include=dev && npm run build -w @muzikhub/shared && npm run build -w @muzikhub/api`
- **Start command:** `npm run start -w @muzikhub/api` (runs `node dist/server.js` in `apps/api`, so the relative `sslrootcert` resolves)
- **Health check path:** `/api/v1/health`
- **Instances: 1** (in-memory state, §2 #14). Auto-deploy: your choice. Don't add migrations to a pre-deploy command until the first manual run is done and verified.

### 6.3 Supabase

- Use the **Session pooler** string (Connect → Session pooler). The direct host is IPv6-only on Free.
- Optional: a dedicated `prisma` role (Supabase's Prisma guide) instead of `postgres`.
- Apply migrations (§3) **only after your confirmation**.
- Schedule `pg_dump` backups.

### 6.4 DNS (option A)

- `app.<domain>`: CNAME as Vercel shows (or A record for the apex), added under Vercel → Domains.
- `api.<domain>`: CNAME to `<service>.onrender.com`, added under Render → Custom Domains (TLS issued automatically).
- Resend: the SPF (TXT), DKIM (TXT/CNAME) and optional DMARC records Resend lists for `mail.<domain>`. Wait until Resend shows **Verified**.

### 6.5 Order of operations

1. Decide A or B; make the code changes in §7; test with `npm run build` and the e2e suite.
2. Rehearse migrations on PostgreSQL 17, then **with your approval** apply them to Supabase (§3).
3. Create the Render service with the env vars; wait for health 200: `curl -fsS https://<api>/api/v1/health`.
4. Create the Vercel project; deploy.
5. Register your own account on the live site, then grant the first admin from your machine:
   `set -a; . apps/api/.env.supabase; set +a; npm run admin:grant-initial -w @muzikhub/api -- --email <you>`
   (needs a verified email address). Then enrol 2FA at `/admin`.

### 6.6 Post-deployment smoke tests

1. `GET /api/v1/health` returns 200 with database ok.
2. Open a deep link (`/communities`) directly and reload: the app loads, not a 404.
3. Register, then reload `/home`: still signed in (proves cookies). Sign out, then sign in.
4. Password reset email arrives (only once the domain is verified).
5. Upload an image to the portfolio (Cloudinary), see it in the feed.
6. Two browsers: send a message, and it arrives without reload (proves WebSockets).
7. Create a community, discussion and comment; send a collaboration request; open `/competitions`.
8. `/pricing` shows plans as unavailable and no payment can start (`PAYMENTS_MODE=off`).
9. Response headers: the API has Helmet's; the web has the `vercel.json` headers.
10. Admin console: 2FA enrolment, a report, audit log entries.
11. A phone at 360 px: bottom navbar and menu drawer work; no horizontal scroll.

---

## 7. Code and config changes this audit recommends (not made yet)

1. `vercel.json` with the SPA fallback and security headers (plus the rewrite for option B).
2. Production startup guards: refuse `localhost`/`http:` in `CORS_ORIGINS`, `WEB_APP_URL` and `BETTER_AUTH_URL` when `NODE_ENV=production`.
3. Option B only: Socket.IO `transports: ['polling', 'websocket']` (or `tryAllTransports: true`), and Better Auth `advanced.ipAddress` for the two-hop chain, verified on a preview deployment.
4. Call `closeRealtime()` in the shutdown handler.
5. Optional: `.node-version` file (`24`) so Vercel and Render agree with CI.
