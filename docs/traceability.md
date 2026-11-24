# MuzikHub — SRS v1.0 traceability

_Phase 0 audit 2026-11-24, updated at the end of **M0** (branch `chore/m0-foundation`). Source: MuzikHub SRS v1.0 (FR-01 to FR-73). Evidence is the code and tests as they are today._

**Status vocabulary (SRS §9):**
- **I&T** = Implemented and tested
- **INFT** = Implemented, not fully tested
- **Partial** = Partially implemented
- **Blocked** = Externally blocked (the blocker is named)
- **Not started**

**Test IDs:** `api:<file>` is a Vitest file in `apps/api/src`; `e2e:<file>` is a Playwright spec in `e2e/`.

**Depth** is the proposed depth (L1 thin / L2 standard / L3 full). It is final only once the remaining hours are known.

## 1. Account management and onboarding (M1)

| FR | Requirement (short) | Status | Evidence (screen · API · data · test) | Gap to close | Depth |
|---|---|---|---|---|---|
| FR-01 | Register with name, username, email, password | I&T | `/register` · `POST /api/auth/sign-up/email` · `user` · api:auth.test, e2e:registration | Uniform responses for "email taken" (enumeration review) | L2 |
| FR-02 | Log in, log out, secure sessions | I&T | `/login` · Better Auth sessions (HTTP-only cookie, DB sessions) · **M0:** CSRF origin check on `/api/v1` writes, scrypt at the OWASP minimum with rehash-on-login · api:auth.test, api:security.test, api:password.test, e2e:registration | Session rotation review (M1); `/login` LCP 3.2 s → 2.5 s target (M1) | L2 |
| FR-03 | Primary use chosen at registration | I&T | `/register` step 1 (`PRIMARY_USES`) · `user.primaryUse` · e2e:registration | — | L2 |
| FR-04 | Guided, role-aware profile completion | I&T | `/onboarding` (`stepsFor`: fans skip professional steps; progress saved server-side) · `profile.onboardingStep` · api:profiles.test, e2e:registration | — | L2 |
| FR-05 | Skip optional onboarding, finish later | INFT | "Skip", "Skip & finish", "Finish later" in OnboardingPage | No test clicks Skip / Finish later | L2 |
| FR-06 | Update profile and professional roles | I&T | `/settings/profile` · `PATCH /me/profile`, `PUT /me/profile/links` · api:profiles.test | — | L2 |

## 2. Professional profiles (M2)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-07 | Individual professional profiles | I&T | `/u/:username` · `GET /profiles/:username` · `profile` · api:profiles.test, e2e:registration | — | L2 |
| FR-08 | Bio, images, roles, genres, location, links | I&T | EditProfile, LinksEditor (14 platforms with brand icons) · avatar/cover via Cloudinary · api:profiles.test, api:media.test | — | L2 |
| FR-09 | Showcase music, releases, portfolios | I&T | `/studio`, `/work/:id` · `/portfolio` routes · `portfolio_item` · api:portfolio.test, e2e:milestone2 | — | L2 |
| FR-10 | View others' profiles and work per visibility | I&T | PUBLIC/PRIVATE items; hidden accounts excluded (`visibleUser`) · api:portfolio.test, api:admin.moderation | — | L2 |

## 3. Music and content management (M2)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-11 | Upload and publish content | I&T | Signed direct upload → `POST /media/:id/confirm` → publish · `media_asset` · api:media.test, e2e:milestone2 | — | L2 |
| FR-12 | Edit and manage published content | I&T | `PATCH`/`archive`/`DELETE /portfolio/:id`, post edit/delete · api:portfolio.test, api:feed.test | — | L2 |
| FR-13 | Metadata: titles, descriptions, genres, creator | I&T | `portfolioFields` (title, description, genres ≤5, credits) · api:portfolio.test | — | L2 |
| FR-14 | Access and play audio | INFT | Native `<audio controls preload="none">` on items and posts · e2e:milestone2 checks the element exists | No test of actual playback. The **persistent player with lock-screen controls (Media Session)** asked for in M2 doesn't exist | L2 |
| FR-15 | Validate formats and upload limits | I&T | `MEDIA_RULES` (formats, 10/50/100 MB, duration); confirm step re-checks what Cloudinary detected · api:media.test | EXIF stripping not verified; no malware scan (Cloudinary add-on, cost) | L2 |

## 4. Discovery and search (M3)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-16 | Discover music, artists, professionals | I&T | `/discover` · `GET /discover/people`, `/discover/work` · api:discover.test | — | L2 |
| FR-17 | Search users and content | I&T | `q` matches name, username, bio, location, skills; work title, description, credits (case-insensitive `contains`) | Postgres full-text search + debounce (prompt M3); ranking | L2 |
| FR-18 | Filter by genre, role, location | I&T | `roles`, `genre`, `location` params · api:discover.test | — | L2 |
| FR-19 | Real data, not demo content | I&T | All queries hit the DB; no seed or demo data in the app | — | L2 |

## 5. Connections and collaboration (M4)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-20 | Send connection requests | I&T | `POST /connections` · `connection` (PENDING) · api:network.test, e2e:milestone2 | Block check (no blocking yet) | L2 |
| FR-21 | Accept, reject, manage requests | I&T | accept / decline / cancel; 30-day re-request after decline · api:network.test | — | L2 |
| FR-22 | View and manage connections | I&T | `/network`, `DELETE /connections/:id` · api:network.test | — | L2 |
| FR-23 | Express collaboration interest, find collaborators | Not started | No model, API or screen | Whole feature (collaboration requests + interest lifecycle, CLAUDE.md §12) | L2 |

## 6. Communities and discussions (M6)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-24 | Discover and join communities | Not started | — | Models, API, screens | L2 (L1 if time is short) |
| FR-25 | Participate in discussions | Not started | — | | |
| FR-26 | Create posts and comment | Not started | — | | |
| FR-27 | Leave communities | Not started | — | | |
| FR-28 | Report content or behaviour | Partial | Reports for POST, PORTFOLIO_ITEM, PROFILE (UI + API); COMMENT via API only, no button · api:admin.moderation | Report buttons on comments; community-post and message targets once those exist | L2 |
| FR-29 | Community moderators manage content and rules | Not started | Platform moderation exists (M5); community-scoped roles do not | Scoped roles (owner/admin/moderator/member) | |

## 7. Competitions (M7) and 8. Opportunities (M8)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-30 | Browse competitions | Not started | — | Full slice | L2 / L1 |
| FR-31 | Details: eligibility, deadlines, requirements | Not started | — | | |
| FR-32 | Submit entries | Not started | — | | |
| FR-33 | Organisers manage and review | Not started | — | Organiser role / permission (decision D7) | |
| FR-34 | Discover gigs, auditions, events, jobs | I&T (L1) | `/opportunities` (type chips, location, include-closed) · `GET /opportunities` · `opportunity` · api:opportunities.test, e2e:opportunities | Notifications to organisers/applicants (M4) | L1 |
| FR-35 | View details and requirements | I&T (L1) | `/opportunities/:id` · drafts visible only to their organiser (404 to others) · api:opportunities.test, e2e:opportunities | — | L1 |
| FR-36 | Apply or express interest | I&T (L1) | apply once (Idempotency-Key), withdraw and re-apply before the deadline; server enforces deadline/state/own-opportunity · `opportunity_application` · api:opportunities.test, e2e:opportunities | — | L1 |
| FR-37 | Organisers publish and manage | I&T (L1) | D7: admin grant (`POST /admin/users/:id/organiser`, audited, UI on member page) + verified email + professional account; draft → publish → close; shortlist/accept/decline (audited) · api:opportunities.test, e2e:opportunities | Edit history; FR-63 admin oversight of opportunities | L1 |

## 9. Promotion (M9) and 10. Payments (M9)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-38 | Request promotional campaigns | Partial (foundation) | `Promotion` model; `grantPromotion` (owner only, extend-not-overlap, advisory lock) + tests in `modules/billing/entitlements.test.ts`. No purchase flow yet (Phase 3–4) | Payment lifecycle | L2 / L1 |
| FR-39 | Show promotion options and costs | Partial | Versioned `service_catalogue` seeded from the confirmed table; `GET /api/v1/catalogue` + `/pricing` show every product as "Coming soon" with **no price** (nothing sellable: `SELLABLE_PRODUCTS = []`). Admin price editing audited (`billing.routes.test.ts`, `e2e/pricing.spec.ts`) | Benefits built and tested before any product goes on sale | |
| FR-40 | Review campaign and track status | Not started (owner read endpoint only) | `GET /billing/promotions/:id` behind `lib/policy.ts` | Phase 4 | |
| FR-41 | Admins manage campaigns | Partial | Admin catalogue prices/availability (`pricing.manage`), read-only billing records (`billing.view`); campaign management in Phase 6 | | |
| FR-42 | Initiate payment | Partial: **TEST PROVIDER only**; live **Externally blocked** | `POST /checkout` (Idempotency-Key, reuse, cap 3, 3 h DB-time TTL, price snapshot, email-only to provider), `PAYMENTS_MODE` off/sandbox/live gates; `payments.test.ts`, `payments-env.test.ts`. Notch Pay adapter is a fail-closed stub | Notch Pay access + answers (decisions-and-risks §8.1); owner live approval | L2 |
| FR-43 | Verify outcome via provider | Done for TEST PROVIDER; Notch Pay mapping ready (unit-tested), adapter blocked | Webhook = trigger only → outbox `payments.verify` → `getPayment` → state machine (amount/currency/reference match, unknown = not paid); signature in adapter; event-id de-dup | Notch Pay signature bytes/key (§8.1 q1) | |
| FR-44 | Record transactions and statuses | Done (sandbox) | `payment_order` (+ CHECKs), `payment_order_event` history, `payment_webhook_event` (hash only, 90-day retention); admin list + LIVE-only revenue | | |
| FR-45 | Pending, failed, cancelled, refunds | Done (sandbox) | `docs/payments-state-machine.md` (117-pair test), member cancel, reconciliation + expiry, NEEDS_REVIEW, admin refund (audited, fee not refunded, entitlement → REFUNDED) | Admin management screens (Phase 6) | |
| FR-46 | Fulfil only after server-side verification | Done (sandbox; registry has no real fulfillers yet) | One transaction + unique (order, fulfiller); failure → FULFILMENT_PENDING, outbox retry, reconcile re-queue; tested no-duplicate | Real fulfillers: Phase 4 (promotions), Phase 5 (subscriptions) | |

## 11. Real-time messaging (M10)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-47 | Start one-to-one conversations | Not started | No Socket.IO, no models | Full slice | L2 / L1 |
| FR-48 | Send and receive in real time | Not started | — | | |
| FR-49 | Persist history | Not started | — | | |
| FR-50 | History after reconnect or sign-in | Not started | — | | |
| FR-51 | Delivery and read indicators | Not started | — | | |
| FR-52 | Compose offline, queue | Not started | — | Depends on M11 outbox | |
| FR-53 | No duplicates on retry | Not started | — | Client message ID + unique constraint | |
| FR-54 | Block or report users | Partial | Profile reports exist; **no blocking anywhere** | Block model, enforced in connections, messaging, calls | L2 |

## 12. Audio and video calls (M12)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-55 – FR-60 | Initiate, accept/decline, controls, states, recovery, audio-only fallback | Not started; **TURN provider undecided** | — | TURN (D4), signalling over the M10 socket | L1 |

## 13. Administration and moderation (M5)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-61 | Admins view and manage accounts | I&T | `/admin/users` · admin users API · api:admin.users, api:admin.permissions, e2e:admin-console | — | L2 |
| FR-62 | Moderators review reports, act | I&T | `/admin/reports` lifecycle · api:admin.moderation, e2e:admin-console | — | L2 |
| FR-63 | Admins manage competitions, opportunities, campaigns | Not started | Depends on M7–M9 | | L1 |
| FR-64 | Review payment records | Not started | Depends on M9; FINANCE_ADMIN deferred | | L1 |
| FR-65 | Audit important admin actions | I&T | `audit_log` append-only (DB triggers) · api:admin.permissions (immutability) | Extend to new areas | L2 |
| FR-66 | Server-side role and permission checks | I&T | `requireStaff`, `requirePermission`, shared matrix · api:admin.permissions | `docs/permissions.md` for the new areas | L2 |

## 14. Offline support and synchronisation (M11)

| FR | Requirement | Status | Evidence | Gap | Depth |
|---|---|---|---|---|---|
| FR-67 | Offline-capable app shell | Not started | No service worker | PWA tooling (D12) | L1 |
| FR-68 | Preserve drafts during interruptions | Partial | Feed composer draft in `localStorage` (per user) | IndexedDB outbox; other forms | |
| FR-69 | Cached non-sensitive content | Not started | — | | |
| FR-70 | Communicate offline, reconnecting, sync states | Not started | — | | |
| FR-71 | Sync pending operations on reconnect | Not started | — | Idempotency keys server-side | |
| FR-72 | No unsafe duplicates during sync | Not started | — | | |
| FR-73 | Say when a live connection is required | Not started | — | | |

## Summary

| Status | Count |
|---|---|
| Implemented and tested | 28 (FR-01–04, 06–13, 15–22, 34–37 at L1, 61, 62, 65, 66) |
| Implemented, not fully tested | 2 (FR-05, FR-14) |
| Partially implemented | 3 (FR-28, FR-54, FR-68) |
| Externally blocked (expected) | 1: FR-42 live payments (Notch Pay access; FR-43–46 are built against the TEST PROVIDER). Also expected: and FR-55–60 become Blocked if provider access or TURN isn't available) |
| Not started | 40 |

## Non-functional requirements (SRS §5)

| Group | Status | Evidence | Main gaps |
|---|---|---|---|
| 5.1 Performance | Partial | Code-split routes; guarded pages download alongside their guard. **CI gates:** JS budget per route (`scripts/js-budget.mjs`) and Lighthouse CI. Measured mobile: `/` LCP 2.1 s, CLS 0; `/login` and `/register` 3.17–3.44 s across runs | Auth pages to 2.5 s (M1); Postgres full-text search (M3) |
| 5.2 Reliability | Partial | RFC 9457 errors; reads retried, mutations never auto-retried. **M0:** Idempotency-Key on post, comment, connection and report creates; transactional outbox with retries | Error boundaries per route (M1); structured logs with correlation IDs |
| 5.3 Security | Partial → much improved | **M0:** scrypt at OWASP minimum + rehash (ADR 0001); CSRF origin/Fetch-Metadata check; per-class rate limits (429 + Retry-After); email-verification flag; audit-ci + gitleaks in CI. Existing: HTTP-only sessions, server-side authorisation, Zod validation, Helmet, admin 2FA + append-only audit | CSP for the web app (Vercel headers, M13); breached-password check (M1); threat models (M13) |
| 5.4 Usability and accessibility | Partial | Landing + draft pages axe-clean; every app screen tokenised (olive palette); axe sweep across all screens in M0 (see M0 report) | 44 px target audit; skip link and error boundaries in the app shell (M1) |
| 5.5 Network resilience | Partial (foundation) | **M0:** server idempotency and outbox; client outbox designed (ADR 0003 §3) | Service worker, IndexedDB outbox, sync states (M11) |
| 5.6 Maintainability | Partial → much improved | **M0:** Prettier, Oxlint + design-token guard, GitHub Actions CI (quality, test, e2e, performance, security), OpenAPI 3.1 skeleton with a drift test, ADRs 0001–0003 | Response schemas per operation (per milestone); `docs/permissions.md` (M1/M5) |

## M0 deliverables (2026-11-24)

| Item | Status | Evidence |
|---|---|---|
| Formatting commit + `.git-blame-ignore-revs` | I&T | `a18e568`; Prettier check in CI |
| Oxlint + token guard | I&T | `npm run lint` passes; `scripts/check-tokens.mjs` |
| Palette tokenisation of the 34 app files | I&T | 323 values converted, legacy aliases removed; token guard 0 findings |
| RFC 9457 errors | I&T | api:problem.test; migration note |
| CSRF origin check, rate limits | I&T | api:security.test |
| Password storage (C1) | I&T | api:password.test; ADR 0001 |
| Email-verification flag (C2) | I&T | api:verification.test |
| Idempotency keys, outbox | I&T | api:idempotency.test, api:outbox.test; ADR 0003 |
| OpenAPI 3.1 skeleton | I&T | api:openapi.test (drift + structure); Redocly lint valid |
| CI workflow | Implemented, not run on GitHub | All job steps run locally, incl. on a fresh clone (see M0 report); first GitHub run happens when the branch is pushed |
