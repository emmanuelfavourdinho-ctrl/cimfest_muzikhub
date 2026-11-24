# ADR 0004 — Payment architecture (Notch Pay)

- **Status:** accepted (owner, Phase 1 review, 2026-11-24). Phase 2 built the catalogue and entitlements. **Phase 3 built the lifecycle against the TEST PROVIDER only.** The Notch Pay adapter is a fail-closed stub: **live payments are Externally blocked.** The Phase 3 addendum overrides earlier text where they conflict; see "Phase 3 decisions" below.
- **Context:** `docs/monetization-audit.md`. The Notch Pay docs document an HMAC-SHA256 webhook signature, but the pages **conflict** on which bytes are signed (raw body vs re-serialised JSON). There's no timestamp, the retry schedule is undocumented, there's no status enum, and recurring billing isn't documented. Live access: **not yet confirmed** (externally blocked).

## Decisions

### Money and catalogue
- Prices are **whole XAF (FCFA) integers**. There are no decimals and no minor units in our data. Phase 3 confirms with Notch Pay how `amount` is interpreted (audit question 3) before any live call.
- The **customer price = the catalogue price**. MuzikHub absorbs the Notch Pay fees: 2.5% collection, plus 1% on withdrawal (pricing page). Margins are in the audit.
- **The catalogue is versioned:** a price change inserts a new row with `effectiveFrom`; rows are never updated. An order (Phase 3) **snapshots** the price, product, option and duration when it's created, so later price changes never touch past orders.
- **A product is sold only when its benefits are built and tested.** A code-level allow-list (`SELLABLE_PRODUCTS`, empty in Phase 2) gates activation, so an admin can't put a product on sale early.

### Order reference
- The format is `mh_` + 128 random bits in base64url (22 characters), e.g. `mh_q2Xo9vT0yJk1bZ3sW8cR4A`. It's unguessable, unique (a unique constraint plus a CHECK on its format) and contains **no personal data** (no name, email, phone or user id). It's sent to the provider as `reference`. _(Changed in Phase 3 from `mh_<cuid2>`: cuid2 isn't designed to be unguessable.)_

### Keys
- The public key (`pk_…`) and the private key (`sk_…`, sent as `X-Grant`) **both stay server-side**. Notch Pay's examples use the public key for create and retrieve; we still call the API only from our server.
- The **webhook hash** (`hsk_…`) is server-only.
- None of these ever go in a `VITE_` variable, logs or Git. The env names are `NOTCHPAY_PUBLIC_KEY`, `NOTCHPAY_PRIVATE_KEY`, `NOTCHPAY_WEBHOOK_SECRET` (already validated, optional, in `config/env.ts`).

### Checkout (Phase 3 plan — superseded where different by "Phase 3 decisions" below)
1. `POST /api/v1/checkout` (member; **Idempotency-Key required**; `checkout` rate-limit class). The server looks up the current catalogue row, creates an `Order` (PENDING, price snapshot, reference), then calls the provider's `createCheckout({ amount, currency: 'XAF', reference, email, callback, description })` and returns `authorization_url`.
2. The customer pays on Notch Pay's hosted page. We never see card or Mobile Money credentials (PCI scope reduction).
3. The redirect `callback` lands on `/checkout/result?ref=…`. **That page only shows the status our API reports.** It never trusts the query string's `status`.

### Webhook (Phase 3 plan — superseded where different by "Phase 3 decisions" below)
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

### Verification and fulfilment (Phase 3 plan — superseded where different by "Phase 3 decisions" below)
- The outbox job calls the provider's `retrieve(reference)` (`GET /payments/{reference}`) **from our server**.
- It fulfils **only if** `status === 'complete'` **and** amount = the order snapshot **and** currency = `XAF` **and** reference = the order reference.
- **Unknown statuses** (none are enumerated in the OpenAPI spec) are treated as **not paid** and left pending.
- `failed`, `canceled`/`cancelled`, `expired`, `rejected` and `abandoned` → the order FAILED/CANCELLED/EXPIRED; nothing granted.
- `incomplete` (paid less) → not fulfilled; flagged for an admin.
- `refunded`/`partialy-refunded` → revoke (Phase 3 refund policy).
- **Fulfilment** is one transaction: order PAID, payment record, entitlement granted (Phase 2 service), audit entry. Conditional update on `status = 'PENDING'` makes it idempotent.

### Reconciliation (Phase 3 plan — superseded where different by "Phase 3 decisions" below)
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

## Phase 3 decisions (owner addendum, 2026-11-24)

### Payment mode
- **`PAYMENTS_MODE = off | sandbox | live`**, default **off**, validated at startup (`config/env.ts`). Messages name the rule, never a value.
  - **off:** every checkout gets `503 PAYMENTS_OFF`. The webhook route answers 404.
  - **sandbox:** every order is stored with `mode = SANDBOX` and is **excluded from every revenue query, permanently** (`revenueSummary` counts `LIVE` only). Any checkout UI must show a visible **"Test payments"** banner.
  - **live:** refused at startup while `LIVE_PAYMENTS_APPROVED` (`config/payments-approval.ts`) is `false`. That's a reviewed code change, so an environment variable alone can never turn on real money. Live also requires `PAYMENTS_PROVIDER=notchpay` and all three `NOTCHPAY_*` variables.
- **`PAYMENTS_PROVIDER = fake | notchpay`**. The default is `fake` outside production and `notchpay` in production. **Production refuses `fake`** (env validation, plus `createProvider` as a second check).
- **Sandbox in production** is refused unless `PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION=true`.
  - **Why:** a sandbox order is fulfilled with **real** benefits for fake money.
  - On the public site, that would let anyone get paid features free, and the orders would mix with real ones.
  - The override exists only for a deliberately configured staging deployment.

### Provider interface (`modules/payments/provider.ts`)
`PaymentProvider` owns everything provider-specific; the webhook route, state machine and fulfilment know nothing about signing or vocabularies:
- `createCheckout(input)`
- `getPayment(reference)`: server-to-provider verification, the only source of "paid"
- `cancelPayment(reference)`
- `refund(...)`, optional, gated by `supportsRefund`
- `verifyWebhook(rawBody, headers)`: returns an authenticated `{ eventId, type, reference, signatureVariant }` or throws
- `normaliseStatus(raw)`

The adapters:
- **TEST PROVIDER** (`providers/fake.ts`): in-process, no network, labelled `TEST PROVIDER` in references (`TEST-PROVIDER-trx_…`, `TEST-PROVIDER-evt_…`) and logs. Its own webhook scheme is `x-test-provider-signature: v1=<hex HMAC-SHA256(per-process secret, raw body)>`, checked with `timingSafeEqual`.
- **Notch Pay** (`providers/notchpay.ts`): a **stub that fails closed**.
  - Every call returns `503 PAYMENTS_EXTERNALLY_BLOCKED`, and every webhook is rejected.
  - It **reads no keys** and **makes no requests**.
  - The pure mapping (`providers/notchpay-mapping.ts`, unit-tested from the documented shapes) is ready.

### Notch Pay → normalised status mapping
Exact string match: no case folding and no trimming. **Anything else is `unknown`, which is never paid.**

| Notch Pay `status` | Normalised | Order effect |
|---|---|---|
| `complete` | `paid` | → FULFILMENT_PENDING only if amount, currency and reference match and the order hasn't expired; otherwise → NEEDS_REVIEW |
| `pending` | `pending` | none |
| `processing` | `processing` | PENDING → PROCESSING |
| `failed`, `rejected` | `failed` | → FAILED |
| `canceled`, `cancelled`, `abandoned` | `cancelled` | → CANCELLED |
| `expired` | `expired` | → EXPIRED |
| `incomplete` (paid less) | `incomplete` | → NEEDS_REVIEW |
| `refunded`, `partialy-refunded` (sic), `partially-refunded` | `refunded` / `partially_refunded` | FULFILMENT_PENDING/FULFILLED → NEEDS_REVIEW (refund made outside MuzikHub) |
| anything else, including `Complete`, `success`, `paid` | `unknown` | none (not paid) |

**Amount units are Unverified** (audit questions 3 and 4). `notchPayAmountToXaf` / `xafToNotchPayAmount` are the only conversion points.
- They assume whole francs.
- They accept only positive safe integers.
- An unreadable amount can't match an order, so it's never fulfilled.

### Orders and checkout
- `POST /api/v1/checkout` (member, ACTIVE account, `checkout` rate limit of 5/min and 30/h, **Idempotency-Key required**).
  - **Idempotency** is enforced on the order itself: a unique (`userId`, `idempotencyKey`) plus a request hash.
    - Same key and same body → the original order (`Idempotent-Replayed: true`).
    - Same key and a different body → **422**.
  - **Reuse:** an open order for the same product and option is returned instead of creating another.
  - **Cap:** at most **3** unexpired open orders per member (409 `TOO_MANY_PENDING_ORDERS`).
  - A per-member advisory lock makes reuse and the cap race-free.
- **Expiry:** our TTL is **3 hours**, computed from **database time** (`SELECT now()`).
  - It's authoritative, whatever the provider says.
  - An order past `expiresAt` can **never** be fulfilled. A verified success after expiry goes to **NEEDS_REVIEW**.
- **Callback/return URL:** `WEB_APP_URL + /checkout/return?reference=…`, built on the server. The return page shows only our own order status.
- **Personal data sent to the provider:** the account **email only**, which the provider requires. This is listed for the privacy notice update. The description contains no personal data.
- A provider error while starting checkout closes the order as FAILED (`checkout_init_failed`). Nothing is charged, and the member retries with a new key.

### Webhook (supersedes the Phase 2 text above where different)
- **Route:** `POST /api/v1/payments/webhooks/:provider`. It's mounted on the app **before `express.json()`** with `express.raw` (limit **64 KB**) and **outside** the v1 router, so the browser origin check doesn't apply to this route alone.
- **Checks, in order:**
  - per-IP rate limit (300/min, generous);
  - `Content-Type: application/json` (otherwise 415);
  - adapter `verifyWebhook` (otherwise 400; nothing stored).
- **Storage** (`payment_webhook_event`):
  - **Stored:** provider, **unique event id**, normalised type, our order reference, whether it matched an order, the signature variant, and a **SHA-256 of the raw body**.
  - **Never stored:** customer personal data and the raw body. Never logged: bodies and secrets.
  - **Retention: 90 days**, then a sweep deletes the rows. Order history (`payment_order_event`) is kept.
- **After storing:** enqueue `payments.verify` (outbox, same transaction) only for a known order, then **2xx immediately**. Duplicates get 200 `{ duplicate: true }`. Unknown references get 200 and are recorded as unmatched.
- **Replay safety without timestamps.** Notch Pay webhooks carry no timestamp, so a captured webhook could be resent. Replay safety comes from three things together:
  1. the **unique event id** (a replay is ignored);
  2. **idempotent order state** (row lock plus compare-and-set; a repeated "paid" on a paid order is a no-op);
  3. the **verification call**: nothing changes unless `getPayment` confirms it.

  A replayed webhook can therefore at most cause one more verification call.

### Fulfilment
- A registry keyed by product type (`fulfilment.ts`). **Phase 3 registers no real fulfillers.** Only tests register a TEST_ITEM fulfiller. Promotions (Phase 4) and subscriptions (Phase 5) register themselves.
- `payments.fulfil` is one transaction: lock the order; it must be FULFILMENT_PENDING; run the fulfiller; insert the `payment_fulfilment` row (**unique per order and fulfiller**); → FULFILLED.
  - A failure rolls everything back: the order stays FULFILMENT_PENDING and the outbox retries with backoff.
  - Reconciliation re-queues it if it stalls for 10 minutes.
  - It's never lost and never doubled.
- **Test-only catalogue rows** (`TEST_ITEM`, `testOnly = true`, tied by a CHECK) let the lifecycle be tested without putting any real product on sale.
  - They're created only by test code and the development sandbox.
  - The admin API's schema can't name them, the seed never creates them, and the public and admin catalogues hide them.
  - They're **refused when NODE_ENV=production** (creation and purchase).

### Refunds
- **Who:** ADMIN only (`payments.refund`), with a fresh session (under 15 minutes) and a reason; the refund is audited (`payment.refund`).
- **When:** only if the order's adapter `supportsRefund`, and only from FULFILMENT_PENDING, FULFILLED or NEEDS_REVIEW. A claim (`refundRequestedAt`) prevents a double refund.
- **Effect:** the order → REFUNDED, and its entitlement rows → REFUNDED, which grant nothing. **`providerFeeRefunded = false`** is recorded, because Notch Pay keeps the original fee.

### Reconciliation
- **Runs** every minute in the API when the mode isn't off, and as `npm run payments:reconcile`.
- **What it does:**
  - checks PENDING/PROCESSING orders **older than 2 minutes** with `getPayment` and applies the same state machine;
  - expires orders past `expiresAt` (database time) that the provider doesn't report as paid;
  - re-queues stalled fulfilments.
- **Concurrency:** safe to run twice at once, because every change is row-locked and compare-and-set (tested).

### State machine
`docs/payments-state-machine.md` has the transition table: from, to, trigger, who and side effects, including NEEDS_REVIEW and FULFILMENT_PENDING. Tests cover all 117 status × trigger pairs and keep the document and the code in sync.
