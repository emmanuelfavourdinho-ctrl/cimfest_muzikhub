# MuzikHub

A professional music-industry networking and discovery platform: profiles, creative work, discovery, relationships, communities, collaboration and opportunities in one place.

> **Status:** Milestones 1–2 (accounts, profiles, portfolios, Cloudinary media, feed, discovery, follows and connections) and the Admin Console (phases 1–4) are implemented and tested. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for exactly what works, what is partial, and what is blocked.

## Requirements

- Node.js ≥ 22.12 (developed on Node 26, npm 11)
- Docker (local PostgreSQL)

## Quick start

```bash
npm install

# API environment (git-ignored). Then put a secret in BETTER_AUTH_SECRET:
cp .env.example apps/api/.env
openssl rand -base64 32               # → BETTER_AUTH_SECRET
# Fill in CLOUDINARY_CLOUD_NAME / _API_KEY (15-digit number) / _API_SECRET for uploads

npm run db:up                         # Postgres on localhost:5435 (creates muzikhub + muzikhub_test)
npm run db:migrate                    # apply migrations to the dev database
npm run dev                           # API :4000 + web :5173
```

Open http://localhost:5173 and create an account.

**Notch Pay test keys** (payments are built against a fake provider; live payments are externally blocked, ADR 0004). When you have sandbox keys, put them **only** in your git-ignored `apps/api/.env`, never in the web app, `.env.example`, docs or chat:

```bash
NOTCHPAY_PUBLIC_KEY=
NOTCHPAY_PRIVATE_KEY=
NOTCHPAY_WEBHOOK_SECRET=
```

The server reads them; nothing in the browser ever does. **Nothing uses them yet:** the Notch Pay adapter is a fail-closed stub until live access is approved.

**Payments mode** (`PAYMENTS_MODE`, default `off`). To try the whole lifecycle locally with the labelled **TEST PROVIDER** (no money, no network), set `PAYMENTS_MODE=sandbox` in `apps/api/.env`, restart, and open http://localhost:5173/dev/payments. That page exists only in development builds. `npm run payments:reconcile -w @muzikhub/api` runs one reconciliation pass. See [ADR 0004](docs/adr/0004-payment-architecture.md) and [the state machine](docs/payments-state-machine.md).

**Pricing catalogue:** `npm run catalogue:seed -w @muzikhub/api` adds the owner-confirmed catalogue rows (all off sale). It's idempotent and never changes an existing price; edit prices in the Admin Console → Pricing.

**Demo data (local only):** `npm run demo:seed -w @muzikhub/api` creates five labelled demo accounts (`amara.demo`, `kofi.demo`, `lena.demo`, `joel.demo` (an approved organiser) and `nadia.demo`, all `@demo.muzikhub.test`, password `muzikhub-demo-2026`). It also creates follows, posts, a community with discussions, a conversation, collaboration requests, an opportunity, an open competition and one with published results. Everything is created through the real API. It refuses to run unless `NODE_ENV=development` and the database is local, and it does nothing if demo accounts already exist. Never run it against production.

**Calls** are not built: they need a TURN provider (decision D4). See [docs/calling-assessment.md](docs/calling-assessment.md).

**Emails in development** (password reset, verification) are printed to the API terminal and not sent; copy the link from there. Production sends through **Resend** once a sending domain is verified (see docs/ARCHITECTURE.md §5d). The hosted database will be **Supabase PostgreSQL** (configuration documented, not deployed).

> Existing database volume created before 2026-11-23? Create the test database once:
> `docker exec muzikhub-db psql -U muzikhub -d postgres -c "create database muzikhub_test"`

## Scripts (from the repository root)

| Command | What it does |
| --- | --- |
| `npm run dev` | shared (watch) + API (`tsx watch`) + web (Vite) |
| `npm run build` | Production build of all three workspaces |
| `npm run typecheck` | TypeScript checks everywhere |
| `npm test` | Vitest: shared unit tests + API integration tests (uses `muzikhub_test`) |
| `npm run test:e2e` | Playwright on the production build, mobile + desktop, with real Cloudinary uploads (cleaned up afterwards). Own servers on :4100/:5273. First time: `npx playwright install chromium` |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:migrate` | Create & apply a migration after editing `schema.prisma` |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run db:check -w @muzikhub/api` | **Read-only** check of the database in `apps/api/.env.supabase` (or `-- --env <file>`): wrong-CA refusal, verified TLS, server version, migration state. Never writes |
| `npm run media:cleanup` | Retry failed Cloudinary deletions; remove abandoned uploads (> 24 h). Schedule daily in production |
| `CLOUDINARY_LIVE=1 npx vitest run media.live` (in `apps/api`) | Opt-in test against the real Cloudinary account (uploads and deletes 3 tiny files) |
| `RESEND_LIVE=1 npx vitest run mailer.live` (in `apps/api`) | Opt-in test: one email via Resend's test sender to the `delivered@resend.dev` sink (no real recipient) |
| `npm run admin:grant-initial -w @muzikhub/api -- --email you@example.com` | Make an existing, **verified** account the first administrator (refuses if one exists; audited). Then sign in, open `/admin` and set up two-step verification |
| `npm run admin:reset-two-factor -w @muzikhub/api` | Last-resort staff 2FA recovery from the server (asks for email, reason and confirmation; audited) |
| `npm run brand:upload -w @muzikhub/api` | Parked: uploads the (unlicensed, unused) landing originals to Cloudinary; the manifest goes to the git-ignored `brand-originals/landing/` |

## Layout

```text
apps/web          React + Vite + Tailwind + shadcn/ui (React Router, TanStack Query, RHF)
apps/api          Express API, Better Auth, Prisma schema + migrations
packages/shared   Zod schemas, types and vocabularies used by both apps
e2e/              Playwright end-to-end tests
docs/             Product, architecture, database, API and status docs
CLAUDE.md         Master product & engineering instructions (source of truth)
```

## Documentation

- [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — scope, users, journeys
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it fits together and why
- [DATABASE.md](docs/DATABASE.md) — entities, relationships, planned tables
- [API.md](docs/API.md) — endpoints and error contract
- [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) — tested / partial / blocked
