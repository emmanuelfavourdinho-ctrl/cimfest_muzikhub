# MuzikHub — decisions, conflicts and risks

_Phase 0 audit, 2026-11-24, updated at the end of M0. Companion to `docs/traceability.md`. Section 0 records what the owner has decided._

## 0. Decisions recorded (owner review of Phase 0, 2026-11-24)

**Direction:**
- A real, working product. There's no demo deadline.
- Areas are finished at L2 (happy path, edge cases, permissions, notifications, full tests), milestone by milestone. No SRS area is dropped.
- Build order:
  - M0 foundation;
  - M1 identity;
  - M2 content and player;
  - M3 discovery;
  - M4 connections and notifications;
  - M5 moderation core;
  - M6 communities;
  - M7 opportunities;
  - M8 competitions;
  - M9 messaging;
  - M10 payments and promotion;
  - M11 offline;
  - M12 calls;
  - M13 hardening.

| # | Decision | Status / where |
|---|---|---|
| C1 | Keep scrypt; meet OWASP minimums; ADR; rehash-on-login | **Done (M0).** Better Auth's default (N=2^14, r=16) was below the minimum. Now N=2^17, r=8, p=1, and old hashes upgrade on sign-in. `docs/adr/0001` |
| C2 | Verification optional for now, as a config flag; domain verification is a top-priority blocker | **Flag done (M0):** `REQUIRE_EMAIL_VERIFICATION`. Domain steps in §7 below. **Blocked on the owner** |
| C3 | RFC 9457 in a single commit | **Done (M0):** commit `e63d1af`; `docs/migrations/2026-11-rfc9457-errors.md` |
| C4 | "Before" screenshots from the first commit | **Done (M0)** |
| C5–C8 | Recommendations accepted | Landing frozen and excluded from changes; video on hold; `cuid(2)` for new tables (used by M0's new tables); report state names kept |
| C9 | One formatting commit + `.git-blame-ignore-revs` | **Done (M0):** commit `a18e568` |
| — | Lint tool | **Deviation, veto if needed:** Oxlint instead of ESLint, because TypeScript 7 ships no JS API, so typescript-eslint can't run. `docs/adr/0002` |
| D6 | Minimum age **16**, self-declaration checkbox, no date of birth stored, clear policy | M1. ⚖️ **Legal review** |
| D7 | Organisers: verified industry professionals, admin approval before their first publish, admins can always remove | M7/M8. **Interpretation to confirm:** "verified" = verified email **and** primary use "Industry professional", plus admin approval. There's no document-based verification (see D8) |
| D8 | Verified professionals (badges) | Rec. accepted: **none for release one**; no "verified" badges |
| D9 | Appeals: one per moderation action, reviewed by a different moderator or an admin | M5 |
| D10 | Promotion prices: admin-editable price table in the database; none hard-coded; nothing shown until set | M10. Consistent with CLAUDE.md §16 (proposed FCFA prices stay unapproved) |
| D11 | Copyright and takedown | Rec. accepted: a "copyright" report reason routed to admins (M5); full policy ⚖️ **legal review** |
| D12 | PWA tooling | Rec. accepted: `vite-plugin-pwa` (M11) |
| D13 | Data retention, export, deletion | Rec. accepted: JSON export + self-service deletion with a 30-day grace period (M13); retention periods ⚖️ **legal review** |
| D14 | Languages: English now, i18n-ready strings | From M1, new UI strings go through one catalogue |
| D15 | Data residency | Supabase project region **eu-west-2 (London)**, read from the pooler host. ⚖️ **Legal review** for users in Cameroon (cross-border data) |
| D16 | Collaboration = structured requests (CLAUDE.md §12) | Rec. accepted (M4) |
| D2 | Notch Pay access | **Unanswered** (`[YES, sandbox / YES, live / NO]`). Needed before M10 |
| D4 | TURN provider | Managed. Comparison of 2–3 providers due **before M12**; calls not built until chosen |
| D5 | Hosting | Vercel + Render + Supabase confirmed. An always-on Render instance is needed before **M9**; I'll flag it with the cost at the start of M9 |
| D1 | Team size, launch markets | **Unanswered** |
| — | Cloudinary `muzikhub/brand/landing/` | **Kept** (owner). Not publicly listable (list API 401, untagged), but directly viewable by URL, and the URLs are in the first commit of the **public** GitHub repo. Options in §7 |

## 1. Codebase snapshot

- **Stack:**
  - npm workspaces: `apps/web` (React 19, Vite 8, Tailwind v4, React Router 7, TanStack Query 5, RHF + Zod), `apps/api` (Express 5, TypeScript, Prisma 7 + adapter-pg, Better Auth 1.7 with username + twoFactor), `packages/shared` (Zod contracts).
  - PostgreSQL 18 locally in Docker; Supabase PostgreSQL 17 (migrated, empty).
  - Services: Cloudinary (signed uploads), Resend (mailer, production domain pending).
- **API:** 63 operations in 11 modules under `/api/v1` (health, me, profiles, portfolio, media, feed/posts/comments, users/follow, connections, discover, reports, admin), plus Better Auth under `/api/auth/*`.
  - Errors are `{ error: { code, message, details? } }`, not RFC 9457.
  - Pagination is cursor-based with a capped page size.
- **Data:** 22 models (User, Session, Account, TwoFactor, Verification, Profile, ProfileLink, MediaAsset, PortfolioItem, Post, PostMedia, PostLike, Comment, Report, ReportNote, AuditLog, Follow, Connection, …). IDs are `cuid()`. 5 forward-only migrations.
- **Tests:** 18 Vitest files (190 tests, real PostgreSQL) and 6 Playwright specs (42 tests on the production build, phone and desktop), plus axe on the landing page.
- **Tooling gaps:** no ESLint or Prettier, no CI (`.github/` doesn't exist), no OpenAPI, no ADRs, no dependency or secret scanning, no Lighthouse CI.
- **Git:** its own repository, one commit on `main`, remote `origin` set. Whether the push happened is not verified.

## 2. Conflicts — need your decision

| # | Conflict (where) | Options | Rec. |
|---|---|---|---|
| C1 | **Password hashing.** Prompt §4 says Argon2id (bcrypt as fallback); the code uses Better Auth's default **scrypt** (documented in ARCHITECTURE §5). | (a) Keep scrypt. (b) Switch to Argon2id via a custom hash function (native dependency; existing hashes need rehash-on-login). | **(a)**: ASVS 5.0 and the OWASP cheat sheet accept scrypt with proper parameters. Switching adds a native build dependency and migration risk for no real gain. |
| C2 | **Email verification required** before publishing, messaging or calling (prompt §4, "[confirm]") vs CLAUDE.md §5.1: verification is **optional** at this stage. | (a) Keep optional. (b) Require it now. (c) Require it only for messaging and calls. | **(a) until a verified Resend domain exists.** Without one, Resend can't send to real users, so (b) or (c) would lock everyone out in production. Revisit as (c) once the domain is verified. |
| C3 | **Error format.** Prompt says RFC 9457 problem details; the code uses `{ error: { code, message } }` in every endpoint and in the web client. | (a) Migrate to `application/problem+json` (`type`, `title`, `status`, `detail`, plus our `code`) in one change, with the web client updated alongside. (b) Keep the current format. | **(a)**, in M0/M1: one middleware and one client function, covered by the existing tests. |
| C4 | **"Before" screenshots for the palette (M0).** The palette is already partly applied: tokens and aliases landed with the landing page, so the current app is already partly olive. | (a) Take "before" shots from the first commit (`f7ffcf3`, emerald) in a temporary worktree. (b) Skip "before". | **(a)** |
| C5 | **Landing page frozen** (your instruction) vs M0 "screenshots of every screen" and the "no hex in components" lint rule. | Landing excluded from all edits; it's already token-clean (0 hex). Screenshots only, no change. | Exclude `features/landing` from code changes; include it in screenshots and lint (it already passes). |
| C6 | **"Watch video" button** wanted vs landing freeze, and no video exists. | Add it when you supply the video and lift the freeze. | Wait. Tell me the file or URL and hosting (Cloudinary, which streams with range requests). |
| C7 | **Public IDs.** Prompt: "opaque unguessable IDs"; the code uses `cuid()` (v1: not cryptographically random). | (a) `cuid(2)` for new tables only. (b) Migrate everything. | **(a)**. Existing objects are already authorised per request, so guessing an ID gains nothing. |
| C8 | **Report states.** SRS: open → in review → actioned/dismissed (+ appeal "[decision]"); implemented: PENDING → UNDER_REVIEW → RESOLVED/DISMISSED, no appeals. | Same meaning, different names. Appeals are a policy question (D9). | Keep the names (documented mapping). Appeals as decided in D9. |
| C9 | **Prettier on an existing codebase** reformats almost every file (huge diff, conflicts with any parallel work). | (a) One dedicated `chore: format` commit. (b) Format only touched files. | **(a)**, done first in M0 before any other change. |

## 3. Open decisions (seed list, SRS §7 / prompt §7)

| # | Decision | Options | Rec. | Needed by |
|---|---|---|---|---|
| D1 | **Time and team.** Hours to the demo, team size, launch markets | — | Required to set the depth plan (§5) | Now |
| D2 | **Notch Pay access.** Merchant/sandbox credentials, supported methods (MTN MoMo, Orange Money, cards?), webhook signature scheme | (a) Real sandbox. (b) Labelled sandbox adapter, FR-42–46 Blocked | Confirm access. I'll read the official docs before writing any adapter | M9 |
| D3 | **Email:** verified Resend domain and `EMAIL_FROM` | — | Needed for real-user verification and reset in production | Before launch |
| D4 | **TURN provider** for calls | (a) Managed (Cloudflare Calls TURN, Twilio NTS, Metered). (b) Self-hosted coturn on a VM | **(a) managed**: Render can't host coturn (needs UDP). Short-lived credentials generated server-side | M12 |
| D5 | **Hosting confirmation:** Vercel (web) + Render (API) + Supabase | — | Render needs a plan that supports WebSockets; the free tier sleeps (cold starts break realtime) | M10 |
| D6 | **Minimum age, minors** | 13+ / 16+ / 18+ | 16+ (stated at sign-up) pending legal review | M1 |
| D7 | **Who may organise** competitions and opportunities | (a) Any user. (b) Industry-professional accounts. (c) Admin-approved organisers | **(c)**: an `ORGANISER` capability granted by admins (audited), which limits spam | M7 |
| D8 | **Verified professionals** | none / later | None for release one (no fake "verified" badges) | — |
| D9 | **Moderation policy:** appeals, response times | — | Appeal = a report-on-decision handled by an ADMIN; target time stated, not promised | M5 |
| D10 | **Prices** for promotion | CLAUDE.md proposed FCFA table (pending) | Needs your explicit approval before FR-39 can show costs | M9 |
| D11 | **Copyright and takedown policy** | — | Legal review; meanwhile a takedown report reason routes to admins | M5 |
| D12 | **PWA tooling** | (a) `vite-plugin-pwa` (Workbox, ~build-time only, ~5–10 kB runtime SW). (b) Hand-written SW | **(a)**: proven, handles precache manifests | M11 |
| D13 | **Data retention, export, deletion** | — | Export (JSON) + self-service deletion with a grace period, at L1 | M13 |
| D14 | **Languages** | English only / English + French | English first, strings extractable; French is a strong Cameroon need | — |
| D15 | **Data residency** | Supabase region | Already chosen at project creation. Record which region | — |
| D16 | **Collaboration requests vs SRS FR-23** | Structured requests (CLAUDE.md §12) vs simple "open to collaborate" flag | Structured requests (CLAUDE.md is more specific; it covers FR-23) | M4 |

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Scope vs time:** 44 FRs not started, including 4 hard areas (payments, messaging, offline, calls) | High | High | Depth plan per area (L1 where needed), never silently dropped; decide D1 first |
| R2 | **Payments:** no confirmed Notch Pay access; unknown signature scheme | High | High | Provider interface + labelled sandbox adapter; FR-42–46 marked Blocked, never faked |
| R3 | **Calls fail on mobile networks without TURN**; Render can't host TURN | High | High | Managed TURN (D4), audio-first, honest failure states |
| R4 | **Offline on iOS:** no Background Sync; storage eviction | High | Medium | Flush on `online` and app open; document the limit; keep the outbox small |
| R5 | **Email can't reach real users** (no verified domain) → password reset broken in production | High (today) | High | Verify a domain before launch (D3); keep verification optional meanwhile |
| R6 | **Upload abuse:** large or illegal files, no malware scan | Medium | High | Size and duration limits exist; add per-user rate limits; reports and removal exist; consider a Cloudinary moderation add-on (cost) |
| R7 | **Moderation load** once communities and messaging open | Medium | Medium | Report queue exists; add rate limits, block, spam heuristics before messaging |
| R8 | **No rate limits** on feed, report, connection, upload routes (only auth and admin) | Medium | Medium | Rate limiter per endpoint class with 429 + Retry-After (M0/M1) |
| R9 | **In-memory rate limits and sockets** don't survive restarts or multiple instances | Medium | Medium | Single instance for release one, documented; shared store later |
| R10 | **Supabase Free:** 500 MB, pauses after 7 days idle, no backups | Medium | High | Scheduled exports; upgrade before real users |
| R11 | **Render free tier** sleeps → slow first request, broken WebSockets | High (if free) | Medium | Paid instance for the demo (D5) |
| R12 | **No CI:** regressions can merge unnoticed | High | Medium | GitHub Actions in M0 (typecheck, unit, e2e, build, audit, secret scan) |
| R13 | **CSRF:** `/api/v1` relies on SameSite=Lax + CORS, no Origin check | Low | High | Explicit Origin/Fetch-Metadata check on unsafe methods (M1) |
| R14 | **Prisma CLI doesn't verify the DB certificate** (runtime does) | Low | Medium | `db:check` before every migration (documented) |
| R15 | **Public GitHub repo history contains the photo URLs** (first commit) | High (already public) | Medium | Make the assets authenticated on Cloudinary (URLs stop working), and/or make the repo private, and/or rewrite history (force-push). All need the owner's approval (§7) |
| R16 | **scrypt memory** (128 MiB per hash) on small instances | Medium | Medium | Max 2 concurrent hashes (peak measured 328 MiB); use ≥1 GiB, or set the cap to 1 on 512 MiB (ADR 0001) |
| R17 | **/login and /register LCP 3.2–3.3 s** on throttled mobile (2.9 s before M0) | Certain | Medium | CI ratchet at 3.4 s. Target 2.5 s in M1: trim the auth bundle (auth client, Zod, forms), consider pre-rendering the auth pages |
| R18 | **Intermittent test** `network.test.ts` "30-day cooldown" failed once during M0 and passed in every other run | Low | Low | Watch; investigate in M4 (connections) |

## 5. Gap plan and proposed order

The prompt's order (M0 → M13) holds. M5 (admin core) is largely built, so it's reduced to the gaps. Default depth per prompt §6; final depth after D1.

| Milestone | Still to build | Depth |
|---|---|---|
| **M0** Palette and tooling | Tokenise the 34 app files (237 hex, 1 rgba, 100 px sizes; inventory below). Remove legacy aliases. ESLint (+ rule blocking hex/rgb in components) and Prettier (one commit). GitHub Actions CI. Lighthouse CI with route budgets. axe on every screen. Before/after screenshots at 360/768/1280 | — |
| **M1** Identity | Origin check (CSRF). Uniform auth responses. Breached-password check (Better Auth `haveIBeenPwned` plugin). Rate limits per endpoint class. RFC 9457 (C3). Skip-onboarding test. Error boundaries + skip link in the app shell | L2 |
| **M2** Profiles and content | **Persistent audio player** (mini-player across routes, Media Session lock-screen controls, keyboard, failure state). Playback tests. EXIF verification | L2 |
| **M3** Discovery | Postgres full-text search (tsvector + GIN, migration) + debounce; honest empty states audit | L2 |
| **M4** Connections and collaboration | **Blocking** (model, enforced everywhere). Collaboration requests + interest lifecycle (D16). **Notifications** (model, API, unread) | L2 |
| **M5** Admin core | Comment report button; appeal path (D9); admin views for new areas as they land | L2 |
| **M6** Communities | Models (community, membership with scoped roles, discussions, comments), join/leave, posts, scoped moderation, reports | L2 → L1 |
| **M7** Competitions | Lifecycle draft → open → closed → judged → archived; entries; server-side eligibility and deadlines; organiser review | L2 → L1 |
| **M8** Opportunities | Lifecycle draft → published → closed; applications; organiser publishing | L2 → L1 |
| **M9** Payments and promotion | PaymentProvider + Notch Pay adapter (or labelled sandbox); payment state machine; signed/idempotent webhooks; reconciliation job; campaign lifecycle; admin transaction view | L2 (Blocked parts marked) |
| **M10** Messaging | Socket.IO with session auth; conversations and messages (client IDs, unique constraint); delivery and read receipts; reconnect catch-up; block and report | L2 → L1 |
| **M11** Offline | PWA shell (D12); IndexedDB outbox with idempotency keys; sync states; live-only notices; clear on sign-out | L1 |
| **M12** Calls | Signalling over the M10 socket; TURN credentials; full state set; audio first, then video; fallback | L1 |
| **M13** Hardening | Threat models (STRIDE), security review, performance, cross-browser, release checklist, runbook, rollback | — |

## 6. Hard-coded colour inventory (Section 3)

Excludes the frozen `features/landing/` (0 hex). Counts: hex / one-off pixel sizes.

| File | Hex | px | File | Hex | px |
|---|---|---|---|---|---|
| components/layout/AppShell.tsx | 27 (+1 rgba) | 20 | features/feed/PostCard.tsx | 6 | 5 |
| components/ui/primitives.tsx | 26 | 5 | components/media/Media.tsx | 6 | 1 |
| features/admin/ui.tsx | 24 | 5 | features/network/NetworkPage.tsx | 5 | 2 |
| features/discover/DiscoverPage.tsx | 23 | 9 | components/ui/form.tsx | 5 | 1 |
| features/profile/ProfilePage.tsx | 15 | 11 | features/portfolio/StudioPage.tsx | 4 | 0 |
| features/portfolio/PortfolioEditorPage.tsx | 14 | 1 | features/auth/RegisterPage.tsx | 4 | 1 |
| features/profile/EditProfilePage.tsx | 10 | 0 | features/admin/ReportDetailPage.tsx | 4 | 2 |
| features/home/HomePage.tsx | 10 | 4 | components/ui/Dialog.tsx | 4 | 1 |
| features/admin/AdminLayout.tsx | 9 | 3 | features/profile/SocialLinks.tsx | 3 | 2 |
| components/media/MediaUploader.tsx | 8 | 0 | features/profile/LinksEditor.tsx | 3 | 0 |
| features/portfolio/PortfolioCard.tsx | 6 | 3 | features/auth/VerifyEmailBanner.tsx | 3 | 0 |
| features/auth/AuthLayout.tsx | 3 | 3 | features/admin/TwoFactorSetup.tsx | 3 | 1 |
| features/admin/OverviewPage.tsx | 3 | 0 | features/admin/AuditPage.tsx | 3 | 4 |
| features/portfolio/PortfolioItemPage.tsx | 2 | 3 | features/onboarding/OnboardingPage.tsx | 1 | 3 |
| features/feed/Composer.tsx | 1 | 2 | features/auth/AccountStatusBanner.tsx | 1 | 0 |
| features/admin/ContentPage.tsx | 1 | 2 | features/admin/UsersPage.tsx · UserDetailPage · ReportsPage | 0 | 2 · 1 · 3 |

**Totals:** 237 hex + 1 `rgba()` in 31 files, and 100 one-off pixel sizes across 34 files.

**Exceptions to keep, as documented tokens:**
- Third-party platform brand colours in the profile links (CLAUDE.md §6.2 requires recognisable platform icons). These are `simple-icons` data, not palette colours.
- The QR code's white background in 2FA setup (scanners need high contrast).

## 7. Owner actions with exact steps

### Verify a sending domain in Resend (C2; blocks password reset in production)

You'll need a domain you control. A subdomain such as `mail.<your-domain>` is recommended, so sending reputation stays separate from your main domain.

1. Resend dashboard → **Domains → Add domain** → enter `mail.<your-domain>` and pick the region closest to your users (EU fits a London database).
2. Resend shows the DNS records. Add **exactly** what it shows at your DNS provider. Typically:
   - **MX** record on the `send` host, pointing to Resend's feedback server (priority 10);
   - **TXT (SPF)** on the `send` host;
   - **TXT (DKIM)** on the `resend._domainkey` host.
3. Recommended: a **TXT (DMARC)** record on `_dmarc.<your-domain>` with `v=DMARC1; p=none; rua=mailto:<you>@<your-domain>`. Tighten it to `quarantine` later.
4. Back in Resend → **Verify DNS records**. DNS changes usually propagate within minutes, occasionally up to 48 h.
5. Create a **production** API key with "Sending access" restricted to that domain, and put it in Render (never in Git):
   - `RESEND_API_KEY=…`
   - `EMAIL_FROM="MuzikHub <no-reply@mail.<your-domain>>"`
   - `EMAIL_TRANSPORT=resend`
6. Tell me, and I'll send **one** test email to an address you choose (with your permission) and confirm delivery in Resend. Then you can set `REQUIRE_EMAIL_VERIFICATION=true`.

### Make `muzikhub/brand/landing/` private on Cloudinary (keeps the files)

The assets are kept (your decision), but anyone with a URL can view them, and the URLs are in public Git history. Pick one or more:

- **A. Convert to authenticated delivery (recommended).** The files stay in your account, but unsigned URLs stop working, so the leaked URLs go dead. With your approval I'd run, for each of the 5 assets: `cloudinary.uploader.rename(id, id, { type: 'upload', to_type: 'authenticated' })`. It's reversible: rename back with `to_type: 'upload'`.
- **B. Make the GitHub repository private** (GitHub → Settings → General → Danger Zone → Change visibility). This hides the history from the public, though copies may already exist.
- **C. Rewrite history** to drop `hero-photos.json` from the first commit, then force-push. This is irreversible for anyone who has cloned, and I'll only do it on your explicit instruction.
