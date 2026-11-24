# Implementation status

_Last updated: 2026-11-24 (M0 foundation; Admin Console phases 1–4; landing redesign). Legend: ✅ implemented & tested · 🟡 implemented, not fully tested · 🟠 partial · ⛔ blocked (external) · ⬜ not started._

**Test totals:** 26 shared unit · 109 API integration (+5 live Cloudinary, +1 live Resend, both opt-in) · 28 browser journeys (Pixel 7 + desktop, production build). All passing as of 2026-11-24.

## M0 — Foundation (2026-11-24, branch `chore/m0-foundation`)

| Item | Status | Evidence |
|---|---|---|
| Formatting commit, Prettier, `.git-blame-ignore-revs` | ✅ | commit `a18e568` |
| Oxlint + design-token guard (ADR 0002) | ✅ | `npm run lint` passes; 0 raw colours/pixel sizes |
| Palette tokenisation of 34 app files; legacy aliases removed | ✅ | Before/after screenshots at 360/768/1280 (`e2e/.screenshots/m0/`) |
| RFC 9457 errors (single commit, client + tests) | ✅ | `e63d1af`, api:problem.test |
| CSRF origin check; rate limits on feed, report, connection, upload | ✅ | api:security.test |
| scrypt at OWASP minimum + rehash-on-login (ADR 0001) | ✅ | api:password.test |
| `REQUIRE_EMAIL_VERIFICATION` flag | ✅ | api:verification.test |
| Idempotency keys + transactional outbox (ADR 0003) | ✅ | api:idempotency.test, api:outbox.test; migration applied to local dev and test only |
| OpenAPI 3.1 skeleton + drift test | ✅ | api:openapi.test; Redocly: valid |
| GitHub Actions CI | 🟡 written; every step run locally, incl. on a fresh clone; **not yet run on GitHub** | `.github/workflows/ci.yml` |
| Supabase migration for the new tables | ⛔ needs approval | |
| Auth pages LCP ≤ 2.5 s | ⬜ M1 | currently 3.2–3.3 s; CI ratchet at 3.4 s |

## Milestone 0 (original setup) — Foundation ✅

Monorepo, Postgres + Prisma migrations, API conventions, prototype design system, test setup. Route-level code splitting added in M2 (entry bundle 334 kB / 104 kB gzipped).

## Milestone 1 — Identity & profiles ✅

| Item | Status | Notes |
|---|---|---|
| Registration, login (email/username), logout, sessions, protected routes | ✅ | API + E2E |
| Suspended-account blocking, self-role-escalation prevention | ✅ | API |
| Guided, role-aware, resumable onboarding | ✅ | API + E2E (creator path) |
| Profile editing, multiple roles, external links with brand icons | ✅ | API + E2E |
| **Profile photo and cover upload** | ✅ | Unblocked in M2 — real Cloudinary in E2E |
| Password reset email (Resend) | ✅ / ⏳ | Templates, mailer and transports tested (fake Resend client + 1 live send to Resend's test sink). **Real recipients need a verified sending domain** (pending) |
| Email verification (optional), banner, resend action, `/email-verified` return page | ✅ | API + E2E. Not required for access (approved). Real delivery pending the domain, as above |
| Account deactivation (self-service) | ⬜ | |

## Milestone 2 — Portfolio, media, feed, discovery, relationships

| Item | Status | Evidence / notes |
|---|---|---|
| **Cloudinary signed direct upload** (image, audio, video; audio/video via `resource_type=video`) | ✅ | API tests (fake) + live tests (real account) + E2E |
| Server-side verification of stored files (format, size, duration, audio-vs-video) | ✅ | API tests incl. rejection + deletion |
| Ownership checks on confirm/attach/delete; no reuse of one file in two places | ✅ | API tests |
| Signature tampering (forged `public_id`) refused; replay can't overwrite | ✅ | Live Cloudinary test |
| Upload progress, retry with backoff, cancel, one-tap retry after failure | ✅ | E2E (simulated outage, slow 3G) |
| **Chunked upload** for files > 20 MB | 🟡 | Implemented per Cloudinary's protocol; E2E only used small fixtures — **not yet exercised with a real > 20 MB file** |
| Post/Publish disabled while uploading | ✅ | E2E (this was a real bug found by the test) |
| Media cleanup (failed deletes, unconfirmed, unattached > 24 h) | ✅ | API test incl. simulated Cloudinary outage; `npm run media:cleanup`. **Not yet scheduled** — needs a cron job at deployment |
| Portfolio: create draft, publish, edit, archive, delete, featured, public/private | ✅ | API + E2E |
| Portfolio types (audio, beat, video, image, project) with per-type rules; external links instead of uploads | ✅ | API |
| "Share to feed" (opt-in, ticked by default), no duplicates, removed when private/archived | ✅ | API + E2E |
| Feed: text, images (1–4), audio, video, showcase posts; Discover + Following tabs | ✅ | API + E2E |
| Edit/delete own posts; likes; comments (delete own or on own post); copy link; report | ✅ | API + E2E (like/comment/report UI); edit/delete UI 🟡 not E2E-tested |
| Progressive loading (cursor pagination + infinite scroll) | ✅ | API + E2E |
| Discovery: people by text/role/genre/location; work by text/type/genre | ✅ | API + E2E |
| Following (idempotent, no self-follow at DB level) | ✅ | API + E2E |
| Connections: request (with note), accept, decline, withdraw, remove; race-safe; 30-day re-request cooldown | ✅ | API + E2E (request → accept) |
| Network page (requests, sent, connections, followers, following) | 🟡 | Requests/accept in E2E; other tabs not E2E-tested |
| Lazy loading, no 1280w images on phones, no autoplay, audio `preload="none"`, video poster-first | ✅ | E2E (request counting) |
| Slow 3G usability | ✅ | E2E with Chrome network throttling |
| No horizontal overflow 320–1920 px | ✅ | E2E sweeps (public + signed-in pages) |

### Known limitations (Milestone 2)

- **Reports are stored but not yet reviewed** — the moderation queue is Milestone 5. The UI says reports help keep MuzikHub safe; it doesn't promise a response time.
- **Notifications** for follows, connection requests, likes and comments are not built (Milestone 4). Incoming requests are visible on the Network page.
- Feed ranking is newest-first by design; no engagement-based ranking yet.
- Discovery text search is substring-based; fuzzy search (`pg_trgm`) would help at scale.
- Post attachments can't be changed after posting (text can be edited).
- Discovery lists all active members, including people who skipped onboarding (their cards are sparse).

## Confirmed decisions of 2026-11-24

### Transactional email — Resend
| Item | Status | Evidence / notes |
|---|---|---|
| Official `resend` SDK in the API only; existing mailer extended (no second email service) | ✅ | `apps/api/src/lib/mailer.ts` |
| `RESEND_API_KEY` read server-side; production refuses to start without it and `EMAIL_FROM` | ✅ | Config unit tests |
| Dev prints (not sent), tests capture, production sends via Resend | ✅ | Unit tests |
| Resend errors → safe `EmailDeliveryError`; logs hold only the error code and a masked address | ✅ | Unit tests (fake client) |
| HTML escaping of user names; plain-text part; https-only links | ✅ | Unit + API tests |
| Per-recipient limit (3 per kind per hour) on top of Better Auth's per-IP limits | ✅ | Unit + API tests. In memory (single instance) |
| Idempotency key per one-time token | ✅ | Unit test |
| Live send through Resend | ✅ | Opt-in test: Resend accepted it and reported **delivered to the `delivered@resend.dev` test sink**. No real person was emailed |
| Production sending domain, DNS verification, production `EMAIL_FROM` | ⏳ pending | The Resend account has 0 domains (checked 2026-11-24). Steps in ARCHITECTURE §5d |

### Database — Supabase PostgreSQL
| Item | Status | Notes |
|---|---|---|
| Express + Prisma 7 + adapter-pg kept; no schema change | ✅ | Verified in code |
| Session-pooler connection string documented; goes in git-ignored `apps/api/.env.supabase` | 📄 documented, ⚠ not tested against Supabase | First connection waits for approval |
| Startup SSL rules (verify-full + existing CA required for non-local DBs; no silent downgrade; path resolved against apps/api) | ✅ unit tests + live local TLS check | `config/database.ts` |
| `DATABASE_POOL_MAX` (default 5) | ✅ | |
| Read-only `npm run db:check` (wrong-CA refusal, verified TLS, READ ONLY transaction, migration state, no credentials printed) | ✅ tested locally | Not yet run against Supabase |
| SSL `verify-full` + `sslrootcert` with the installed driver | ✅ verified locally | Against a TLS PostgreSQL with a private CA. Plain `sslmode=require` would fail with this driver |
| Same URL for `prisma migrate deploy` | ✅ verified locally | Limitation: the Prisma 7.10.1 CLI does not verify the certificate (the runtime does) |
| Supabase CA certificate `apps/api/certs/prod-supabase.crt` | ✅ in place | Supabase Root 2021 CA, valid to 2031-04-26 (fingerprint in ARCHITECTURE §7b) |
| Free-plan limits and backup practice documented | ✅ | ARCHITECTURE §7b (official pages; unconfirmed items marked) |
| Supabase database migrated (all 5 migrations, `prisma migrate deploy`) | ✅ 2026-11-24, approved by the owner | Rehearsed first on PostgreSQL 17.12. Verified afterwards: 0 pending, 18 tables + `_prisma_migrations`, audit triggers present, every table empty (not seeded) |
| Application deployed (API / web) | ⬜ **not done; needs approval** | |

### Landing page — olive-and-lime redesign (2026-11-24)
| Item | Status | Evidence |
|---|---|---|
| Palette B (olive-black + lime) as one-file tokens; CLAUDE.md §20 updated | ✅ | `styles/palette.css`; contrast table in ARCHITECTURE §7c |
| Full page: header, hero with illustrative preview, problem (paper), value, who it's for (tabs), how it works, features, trust, roadmap, FAQ, lime CTA, footer | ✅ | `e2e/landing.spec.ts` |
| Every header, section and footer link works; mobile menu traps focus and closes on Escape and navigation; tabs and FAQ by keyboard; signed-in "Open app"; skip link first | ✅ | `e2e/landing.spec.ts` (mobile + desktop) |
| No horizontal scroll at 360, 390, 768, 1024, 1280, 1536 and 844×390 (landscape) | ✅ | E2E sweep |
| axe WCAG 2.2 A/AA: 0 violations (landing, menu sheet, draft pages) | ✅ | E2E |
| Lighthouse (production build, simulated mobile): perf 91–94, a11y/best/SEO 100, LCP 2.0–2.5 s, TBT 190–230 ms, CLS 0. Desktop: 100/100/100/100 | ✅ measured | 3 mobile runs + 1 desktop; wide run-to-run variance (earlier rounds measured 510–850 ms TBT) |
| Landing JavaScript before → after | ✅ | 182.0 → 146.5 kB gzip at first render (+3.6 kB deferred). CSS 10.9 → 13.1 kB |
| Draft /terms, /privacy, /contact, /safety (DRAFT, noindex); register form links Terms and Privacy | ✅ | E2E |
| Original photos removed from the deployed folder | ✅ moved | `brand-originals/landing/` (7 files, untouched, git-ignored). Cloudinary copies still exist |
| Pre-rendering, Lighthouse CI budget gate, visual-regression baselines | ⬜ | Recommended approach in ARCHITECTURE |
| Real contact email, social links, event line, production domain (`VITE_SITE_URL`), photo permissions | ⏳ owner | Pages say "will be published before launch" |
| App screens still use 237 hard-coded legacy colours (31 files) | ⬜ | Platform redesign |

## Admin Console (CLAUDE.md §19.3–19.4) — approved and implemented 2026-11-24

| Phase / item | Status |
|---|---|
| 1. Permission matrix (shared), `requireStaff` / `requirePermission`, rank rule, fresh-session check | ✅ `admin.permissions.test.ts` (role × permission matrix, privilege escalation, IDOR, self-action) |
| 1. Required staff 2FA (Better Auth TOTP + backup codes, no trusted devices); two-step sign-in in the UI | ✅ API tests + Playwright enrolment and code sign-in |
| 1. Append-only audit log (DB triggers block UPDATE/DELETE/TRUNCATE) | ✅ immutability tests run raw SQL against the triggers |
| 1. First-admin CLI `admin:grant-initial`; recovery CLI `admin:reset-two-factor` | ✅ tests + manual run on a copy of the database (unverified email refused, grant, idempotent re-run, second admin refused, exit code 1, one audit row). **Not run against the dev or production database:** the owner runs it with their own email |
| 2. User management: search, detail, restrict / suspend (with limits) / ban / reinstate, role changes (last-admin guard, race-safe), 2FA reset, sessions revoked on suspend/ban, expiry sweep | ✅ `admin.users.test.ts` |
| 2. RESTRICTED enforced on every write route; BANNED/SUSPENDED hidden from all public queries | ✅ |
| 3. Reports queue and lifecycle (assign, notes, escalate, resolve/dismiss, related reports), content moderation (soft remove/restore; avatar/cover permanent removal) | ✅ `admin.moderation.test.ts` + Playwright report journey |
| 4. Overview built from real data (users, content, moderation, staff 2FA coverage, weekly signups) | ✅ |
| Responsive admin pages (320/375/430 px, no horizontal scroll) | ✅ Playwright |
| 5. Community / competition / opportunity oversight | ⬜ added with those pillars; listed as pending in the overview |
| Announcements | ⬜ deferred (disabled "Pending" nav entry) |
| 6. FINANCE_ADMIN and finance views | ⬜ deferred until payments |
| Migration `admin_console_foundation` | ✅ dev + test DBs · ✅ Supabase (2026-11-24) |

### Known limitations (Admin Console)

- Admin rate limits are kept in memory per API instance.
- The audit triggers do not stop the database owner (who can drop them). In production, use a non-owner role for the API.
- Moderators who belong to a community are not yet scoped to it, because communities don't exist yet.
- No email is sent to members when their account status changes; they see the reason in an in-app banner, or a sign-in error if suspended or banned.

## Later milestones

| Area | Status |
|---|---|
| Communities, collaboration requests, opportunities, competitions | ⬜ |
| Messaging (Socket.IO), notifications, offline queue | ⬜ |
| Audio/video calls (WebRTC) | ⬜ (TURN provider needed) |
| Promotions, Notch Pay payments, service catalogue | ⬜ (test keys available; prices pending approval) |
| PWA / offline shell | ⬜ |
| Deployment (Vercel + Render + Supabase) | ⬜ needs approval; DB connection documented, not tested against Supabase |

## Blockers and decisions needed

| Needed | Blocks |
|---|---|
| Verified Resend sending domain + production `EMAIL_FROM` | Real-recipient email |
| TURN service | Reliable calls |
| Supabase project, CA certificate, approval to deploy | Production database |
| Approval of proposed prices | Real billing |
| Approval to migrate production + run `admin:grant-initial` there | Admin Console in production |

## Known issues

- `npm audit`: high findings in the Prisma CLI's `effect` dependency (dev tooling only).
- The per-recipient email limit, admin rate limits and Better Auth's rate limits are in memory: correct for one API instance, reset on restart.
