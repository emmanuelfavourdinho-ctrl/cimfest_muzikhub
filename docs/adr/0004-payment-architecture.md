# ADR 0004 — Payment architecture (Notch Pay)

- **Status:** accepted (owner, Phase 1 review, 2026-11-24). Phase 2 builds the catalogue and entitlements; Phase 3 builds the lifecycle below.
- **Context:** `docs/monetization-audit.md`. The Notch Pay docs document an HMAC-SHA256 webhook signature, but the pages **conflict** on which bytes are signed (raw body vs re-serialised JSON). There's no timestamp, the retry schedule is undocumented, there's no status enum, and recurring billing isn't documented. Live access: **not yet confirmed** (externally blocked).

## Decisions

### Money and catalogue
- Prices are **whole XAF (FCFA) integers**. There are no decimals and no minor units in our data. Phase 3 confirms with Notch Pay how `amount` is interpreted (audit question 3) before any live call.
- The **customer price = the catalogue price**. MuzikHub absorbs the Notch Pay fees: 2.5% collection, plus 1% on withdrawal (pricing page). Margins are in the audit.
- **The catalogue is versioned:** a price change inserts a new row with `effectiveFrom`; rows are never updated. An order (Phase 3) **snapshots** the price, product, option and duration when it's created, so later price changes never touch past orders.
- **A product is sold only when its benefits are built and tested.** A code-level allow-list (`SELLABLE_PRODUCTS`, empty in Phase 2) gates activation, so an admin can't put a product on sale early.

### Order reference
- The format is `mh_<cuid2>`, e.g. `mh_tz4a98xxat96iws9zmbrgj3a`: random, unique, and with **no personal data** (no name, email, phone or user id). It's stored with a unique constraint and sent to Notch Pay as `reference`.

### Keys
- The public key (`pk_…`) and the private key (`sk_…`, sent as `X-Grant`) **both stay server-side**. Notch Pay's examples use the public key for create and retrieve; we still call the API only from our server.
- The **webhook hash** (`hsk_…`) is server-only.
- None of these ever go in a `VITE_` variable, logs or Git. The env names are `NOTCHPAY_PUBLIC_KEY`, `NOTCHPAY_PRIVATE_KEY`, `NOTCHPAY_WEBHOOK_SECRET` (already validated, optional, in `config/env.ts`).

### Checkout (Phase 3)
1. `POST /api/v1/checkout` (member; **Idempotency-Key required**; `checkout` rate-limit class). The server looks up the current catalogue row, creates an `Order` (PENDING, price snapshot, reference), then calls the provider's `createCheckout({ amount, currency: 'XAF', reference, email, callback, description })` and returns `authorization_url`.
2. The customer pays on Notch Pay's hosted page. We never see card or Mobile Money credentials (PCI scope reduction).
3. The redirect `callback` lands on `/checkout/result?ref=…`. **That page only shows the status our API reports.** It never trusts the query string's `status`.

### Webhook (Phase 3)
- **Route:** `POST /api/v1/payments/webhooks/notchpay`, mounted in `app.ts` with `express.raw({ type: 'application/json', limit: '256kb' })` **before** `express.json()`, the same pattern as Better Auth.
  - It's exempt from the CSRF origin check, because it's server-to-server and authenticated by HMAC.
  - It has its own rate limit.
- **Signature:** header `x-notch-signature`; expected value = hex(HMAC-SHA256(webhookHash, bytes)).
  - Try the **raw bytes** first, then the **re-serialised JSON** (`JSON.stringify(JSON.parse(raw))`).
  - Compare with **`crypto.timingSafeEqual`** on equal-length buffers.
  - Log *which variant matched* (never the body or the secret), until Notch Pay confirms the scheme (audit question 1). Then drop the fallback.
  - No match → `400`, nothing stored or processed.
- **De-duplication:** `WebhookEvent` with a **unique `providerEventId`** and a unique (`orderReference`, `type`, `providerEventId`) record. A duplicate gets `200` and is ignored.
- **The webhook is a trigger only.** We store the event and enqueue `payments.verify` in the **outbox** in the same transaction, then answer `200` immediately.

### Verification and fulfilment (Phase 3)
- The outbox job calls the provider's `retrieve(reference)` (`GET /payments/{reference}`) **from our server**.
- It fulfils **only if** `status === 'complete'` **and** amount = the order snapshot **and** currency = `XAF` **and** reference = the order reference.
- **Unknown statuses** (none are enumerated in the OpenAPI spec) are treated as **not paid** and left pending.
- `failed`, `canceled`/`cancelled`, `expired`, `rejected` and `abandoned` → the order FAILED/CANCELLED/EXPIRED; nothing granted.
- `incomplete` (paid less) → not fulfilled; flagged for an admin.
- `refunded`/`partialy-refunded` → revoke (Phase 3 refund policy).
- **Fulfilment** is one transaction: order PAID, payment record, entitlement granted (Phase 2 service), audit entry. Conditional update on `status = 'PENDING'` makes it idempotent.

### Reconciliation (Phase 3)
- A worker re-checks PENDING orders older than 2 minutes through `retrieve`, with backoff, **until the 3-hour expiry** (Collect page) plus a margin. After that, the order is EXPIRED if Notch Pay still reports nothing final.
- This covers lost webhooks and browsers that never return.

### Entitlements (Phase 2)
- **One service** (`modules/billing/entitlements.ts`) is the only place that answers "what may this user do". It's computed at request time from `periodStart ≤ now < periodEnd`, never from a scheduled job. Free is the default.
- **Subscriptions:**
  - same plan → extend from the current end;
  - upgrade (Plus → Pro) → starts now, no proration, disclosed before payment;
  - downgrade → starts when the higher plan ends.
- **Promotions:** at most one running or queued Boost per post and one Spotlight per profile. Buying again **extends** from the current end; periods never overlap.
- **Monthly = 30 days and annual = 365 days**, documented on the pricing page.

### Authorisation
- `lib/policy.ts` is the central policy for billing resources: only the owner, or staff with an explicit permission, can read an order, subscription or promotion. Payment staff permissions arrive with FINANCE_ADMIN (deferred).

### Testing
- An **in-memory fake provider** with signed fixtures for automated tests.
- The real adapter is tested only against documented shapes until sandbox keys exist. **Live payments are marked Externally blocked.**

## Consequences
- Fulfilment always waits for a server-side verification call, adding about a second after the webhook. In exchange, a forged or replayed webhook can never grant anything.
- Subscriptions are manual renewals (no recurring billing documented). Renewal reminders need a verified email domain; until then, on-screen notices only.
