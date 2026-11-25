# MuzikHub monetisation audit (Phase 1, read-only)

_2026-11-24. Repository state at audit time: branch `feat/core-slices`, latest commit `5ebed50` ("feat(opportunities): browse, apply, organise and decide"), **no uncommitted changes** before this file. No code was changed. No Notch Pay API endpoint was called; only public documentation was read. No key or secret was requested, read or stored._

**Owner inputs:** both arrived as unfilled placeholders, so they are treated as follows.
- Notch Pay access: **unknown**.
- Sending domain: **not yet verified**.

**Sources:** official Notch Pay docs at `developer.notchpay.co`, starting from its index `/llms.txt` (89 pages listed); the official OpenAPI spec `developer.notchpay.co/openapi.yaml` (version 2.1.0); and the official pricing page `notchpay.co/pricing`. No unofficial source was used. Pages were read through a fetch tool that summarises, so wording below is paraphrased.

---

## What I could not verify, and why

| Item | Why not verified |
|---|---|
| **Exact webhook signing bytes** | The official pages **conflict**. Some say the HMAC is over the raw body; the verification page's Node example signs `JSON.stringify(req.body)`, the re-serialised body. Those bytes can differ, so the scheme is only **partly verified** (see §1.4) |
| **Webhook key identity** | One page calls it the "webhook hash" (Settings → API Keys, prefixed `hsk_test_` in sandbox); others call it the webhook "secret" (Settings → Webhooks, or returned when you create a webhook). Same value or not: **not stated** |
| **Replay protection** | No timestamp in the signature or signed material. Only an event `id` you can de-duplicate on. Whether the same event can be re-sent later: not stated |
| **Retry schedule** | "Several times with increasing delays" / "exponential backoff". Number of attempts, timing and delivery timeout: **not stated** |
| **Amount units** | One page says "smallest currency unit"; the OpenAPI spec types `amount` as a plain number; every example uses `5000` + `XAF`. What 5000 means in XAF is never stated |
| **Response envelope** | Three different shapes across pages: top-level `transaction`, a `data` wrapper, and a bare UUID in the OpenAPI schema |
| **Retrieve-by identifier** | `GET /payments/{reference}`: whether it accepts our reference, Notch Pay's `pay_…`/`trx.…` reference, or both is unclear |
| **Duplicate `reference`** | Docs say references should be unique; whether a duplicate is rejected is not stated |
| **Expiry** | "Expired after 3 hours" appears only on the Collect page; elsewhere no duration |
| **Status list** | The OpenAPI spec defines **no status enum**. Two pages give different lists (§1.3) |
| **Cards** | The FAQ mentions bank cards, but card processing, fees and countries aren't documented |
| **Recurring / subscriptions / saved methods** | **Not documented anywhere** I read. Treat as unsupported |
| **Refund eligibility** | Which payment statuses can be refunded isn't stated. Window "typically 90 days". Payment-method restrictions are mentioned without detail |
| **Taxes** | Pricing says fees exclude taxes, "added as required by law". No rate given |
| **Customer-pays fee rounding** | Option exists (dashboard). The exact rounding in that mode is not specified |
| **Settlement / payout timing** | For merchant balance withdrawals: not stated |
| **Sandbox "pending" scenario** | Test numbers simulate success, insufficient funds, failure, timeout and cancelled; there's no documented "stays pending" number |
| **HTTPS for callback URLs** | Required for webhooks ("use HTTPS"); for redirect callbacks only "properly URL-encoded and accessible" |

---

## 1. Notch Pay capabilities (official documentation)

### 1.1 Checkout initialisation
- **`POST https://api.notchpay.co/payments`** (legacy alias `POST /payments/initialize`). _Payments API → "Create a Payment"; API reference → "Initialize a payment"; OpenAPI `initializePayment`._
- **Required:** `amount` (number) and `currency` (e.g. `XAF`), plus one of `email`, `phone` or `customer` (a customer id, or an object with name, email and phone).
- **Optional:** `reference`, `callback`, `description`, `locked_channel` (e.g. `cm.mtn`), `locked_country` (e.g. `CM`), `locked_currency`, `items`, `shipping`, `address`, `customer_meta`, and `metadata` (Direct Charge → "Using Metadata").
- **Response (201):** `status`, `message`, `code`, `transaction` (the Notch Pay payment: id `pay_…`, `reference`, `amount`, `currency`, `status`), and `authorization_url` (hosted checkout, `https://pay.notchpay.co/…`). The customer is redirected there. _Payments API → "Create a Payment" response; Collect → "2. Redirect to Collect"._
- **Auth:** `Authorization` header with the account key. The examples use the **public** key for create and retrieve; the **private** key goes in `X-Grant` for "sensitive operations" (refunds, disputes, transfers). _Get started → Authentication → "Types of API Keys", "Authentication Methods"._ Keys never go to our browser code.
- **Idempotency header:** none documented. The docs recommend unique references instead. _Payments API → "Best Practices"._

### 1.2 Our order reference
- **Sent as** `reference` (documented as "Unique reference for the payment"). _Payments API → "Request Parameters"._
- **Returned** in `transaction.reference` on create and retrieve, and in the webhook event's `data.reference`. The example value is `order_123`. _Payments API → "Retrieve a Payment"; Webhooks API → "Webhook Event Object"._
- **On redirect,** the callback URL receives `reference`, `trxref` and `status` query parameters. The example shows `reference=trx.…`, apparently Notch Pay's, and `trxref=order_123`, apparently ours. The mapping isn't stated in prose. _Collect → "3. Handle the Callback"; Direct Charge → "Handling Callbacks"._
- **The docs say never to trust the redirect,** and to verify via the API. _Payments API → "Verify Payment Status"._

### 1.3 Verification endpoint and statuses
- **`GET /payments/{reference}`** returns `transaction` with id, reference, amount, currency, status, customer, payment_method, created_at and completed_at. The docs say to verify with it before fulfilling. _Payments API → "Retrieve a Payment", "Handling Callbacks"._
- **`DELETE /payments/{reference}`** cancels, but only while `pending`. _Payments API → "Cancel a Payment"._
- **Statuses (exact spelling):**
  - Payments API → "Payment Statuses": `pending`, `processing`, `complete`, `failed`, `canceled`, `expired`.
  - Collect → "Payment Statuses" adds: `incomplete` (paid less than the amount), `rejected`, `abandoned`, `refunded`, `partialy-refunded` (spelled that way). `expired` is "after 3 hours". `complete` is final but can be refunded.
  - The OpenAPI spec has no status enum, so we must accept unknown values and treat them as "not paid".

### 1.4 Webhooks: the signature question, stated precisely

| Question | What the official pages say |
|---|---|
| **Header** | `x-notch-signature` (Verifying Webhooks → "How Webhook Verification Works"); written `X-Notch-Signature` elsewhere. HTTP headers are case-insensitive |
| **What is signed** | **HMAC-SHA256** of the payload, hex-encoded, compared with the header. Every code sample computes an HMAC (`createHmac('sha256', key).update(payload)`, `hash_hmac('sha256', $payload, $key)`). **It is not a SHA-256 of the secret** |
| **Which bytes** | **Conflict.** Webhooks API → "Webhook Security" and → "Troubleshooting / Invalid Signature Errors" say to use the **raw request body**, not parsed JSON. Verifying Webhooks → Node example uses `JSON.stringify(req.body)`, the re-serialised body |
| **Key** | The "webhook hash" (test `hsk_test_…`; Settings → API Keys) per Verifying Webhooks → "Getting Your Webhook Hash"; or the webhook "secret" per Webhooks API → "Webhook Security". Not the public or private API key |
| **Body-bound?** | Yes in principle: the HMAC input is the body, so a modified body should fail. No page says it in plain words |
| **Timestamp?** | **None** in the header or the signed material. The event has `created_at`, but nothing says to check its age |
| **Replays detectable?** | Only by storing the event `id` (`evt_…`) and skipping repeats. Webhooks API → "Duplicate Events" and "Handle Retries" say to do this. A captured event could be replayed unless we de-duplicate |

**Assessment:** HMAC over the body is documented, but the signing bytes and key naming conflict, and there's no timestamp. **I mark the scheme Unverified for fulfilment purposes.** The design below is safe whichever page is right:
1. Receive the webhook on a route mounted **before** `express.json()`, so we keep the raw bytes (as we already do for Better Auth).
2. Verify the HMAC against the raw bytes; if that fails, also try canonical JSON, but log which variant matched until Notch Pay confirms. A mismatch on both gets 400, with nothing processed.
3. De-duplicate by event `id` (unique constraint).
4. **Treat the event only as a trigger.** Enqueue an outbox job; reply 200 immediately.
5. The job calls `GET /payments/{reference}` server-side and checks `status === "complete"`, plus **amount, currency and reference equal to our order**. Only then does it mark the order paid and fulfil. **The webhook alone never fulfils anything.**
6. A reconciliation job polls `pending` orders older than N minutes the same way, covering lost webhooks and stopping when they reach the 3-hour expiry.

**Other webhook facts:**
- **Event types** differ across three pages:
  - Webhook Setup lists `payment.created`, `payment.complete`, `payment.failed`, `payment.canceled`, `payment.expired`, `transfer.*` and `customer.*`.
  - Webhooks API adds `payment.processing`, `transfer.processing` and `beneficiary.*`.
  - The create-webhook enum adds `customer.blocked`/`unblocked` but omits `payment.processing`.
  - The Refunds page adds `refund.created`, `refund.complete`, `refund.failed`; the Disputes page adds `dispute.created`, `dispute.updated`, `dispute.closed`, with a payload keyed `event` rather than `type`.
- **Payload:** `{ id, type, created_at, data: { id, reference, amount, currency, status, customer, created_at, completed_at } }`. _Webhooks API → "Webhook Event Object"._
- **Our response:** 2xx (one page says 200 specifically). Reply fast and process afterwards. Failure code shown as 400 in one place and 403 in another. **Retries:** with increasing delays; the count isn't stated.
- **Webhook URLs must use HTTPS** with a valid certificate. _Webhooks API → "Best Practices"._ IP allow-list and ordering guarantees: not stated.

### 1.5 Sandbox and testing
- **Modes:** sandbox or production, chosen in the Business Suite selector. Test keys are `pk_test_…`, and test webhook hashes `hsk_test_…`. Test mode moves no real money. _Testing → "Test Mode vs Production Mode", "Test API Keys"._
- **Same base URL:** `https://api.notchpay.co` for both modes (the OpenAPI server is labelled "Production and Sandbox"). Mode follows the key.
- **Test phone numbers:** a prefix plus `000000` (success), `000001` (insufficient funds), `000002` (failure), `000003` (timeout), `000004` (cancelled). Cameroon MTN `+23767…`, Orange `+23769…`. _Testing → "Phone Numbers for Mobile Money Testing"._ No test cards are published.

### 1.6 Methods and countries
- **Mobile Money channels:** `cm.mobile`, `cm.mtn`, `cm.orange` (XAF), plus Côte d'Ivoire, Senegal, Kenya, Uganda and Ghana channels. _Mobile Money → "Mobile Money Channel Codes"._ The Testing page lists more countries, and the two lists disagree.
- **Other methods:** USSD, QR codes and wallets (e.g. Assoh, Kudi). _Other Methods._ Bank cards are mentioned in the FAQ only.
- **Countries:** "Cameroon, Côte d'Ivoire, Senegal and more"; the full list is via the Countries API. _FAQ._
- **Mobile Money regulatory limits in Cameroon:** up to 500,000 XAF per day and 5,000,000 XAF per month, described as regulatory context. _Mobile Money → "Country-Specific Information"._

### 1.7 Refunds, disputes, recurring
- **Refunds:** full or partial, via `POST /refunds` with `payment` (and `amount` for a partial refund) or via the dashboard.
  - Statuses: `pending`, `processing`, `complete`, `failed`.
  - "Typically within 90 days"; processed in 5–7 business days.
  - No extra refund fee, but **the original fee is typically not refunded**. _Refunds → "Refund Types", "Refund Statuses", "Refund Limitations"._
- **Disputes:**
  - Statuses: `warning_needs_response`, `warning_under_review`, `warning_closed`, `lost`, `won`.
  - Dispute fees "vary"; no amounts given.
  - The evidence-submission endpoint isn't published. _Disputes._
- **Recurring / subscriptions / tokenised re-charge: not documented.** Subscriptions would have to be *manual renewals*: a new checkout each period, with reminders.

### 1.8 Fees (official pricing page)
- `notchpay.co/pricing` → "Rates for Cameroon (XAF)":
  - **2.5% per successful payment**, for MTN MoMo and Orange Money; percentage only, no fixed part. **Fees are rounded up to the next franc.**
  - **1% per transfer or withdrawal**, also rounded up; the minimum withdrawal is 5,000 FCFA.
  - **No setup or monthly fees.** Failed, expired and cancelled payments are free.
  - **Taxes excluded**, added as required by law.
- **Who pays the fee:** the merchant by default. The calculator shows 50,000 collected, 1,250 fee, 48,750 received. A dashboard setting can make the **customer pay the fee**: the customer pays amount plus fee, where the fee is 2.5% of the total they pay. _Pricing → FAQ "Can my customers pay the fee?"._
- **Card fees:** not published.

### 1.9 Redirect and callback rules
- `callback` is a URL; the customer returns there with `reference`, `trxref` and `status`.
- Don't trust it: verify server-side. Webhooks are described as more reliable than callbacks, because the browser may never return. _Payments API → "Webhooks"; Collect → "Best Practices"._

---

## 2. Margin report (documented numbers only)

**Formula** (merchant bears the fee, the default; notchpay.co/pricing):
- collection fee = ⌈ 0.025 × price ⌉ (rounded up to the franc)
- net to balance = price − collection fee
- withdrawal fee = ⌈ 0.01 × amount withdrawn ⌉

Withdrawals are batched (minimum 5,000 FCFA), so the per-sale withdrawal figure below is the pro-rata 1%, rounded up as an approximation. **Taxes are excluded** because no rate is published.

**Prices:** the catalogue in CLAUDE.md, all still **pending your approval**.

| Item | Price (FCFA) | Collection fee | Net | ≈ Withdrawal (1%) | ≈ You keep | Fee share |
|---|---:|---:|---:|---:|---:|---:|
| Post Boost 3 days | 1,000 | 25 | 975 | 10 | 965 | 2.50% + 1.0% → **3.50%** |
| Creator Plus monthly | 1,500 | 38 | 1,462 | 15 | 1,447 | 2.53% → **3.53%** |
| Profile Spotlight 3 days | 1,500 | 38 | 1,462 | 15 | 1,447 | **3.53%** |
| Post Boost 7 days | 2,500 | 63 | 2,437 | 25 | 2,412 | **3.52%** |
| MuzikHub Pro monthly | 3,000 | 75 | 2,925 | 30 | 2,895 | **3.50%** |
| Profile Spotlight 7 days | 3,500 | 88 | 3,412 | 35 | 3,377 | **3.51%** |
| Post Boost 14 days | 5,000 | 125 | 4,875 | 49 | 4,826 | **3.48%** |
| Creator Plus annual | 15,000 | 375 | 14,625 | 147 | 14,478 | **3.48%** |
| MuzikHub Pro annual | 30,000 | 750 | 29,250 | 293 | 28,957 | **3.48%** |

**Reading it:**
- Collection alone is 2.5% (slightly more on small prices because of rounding up).
- Collection plus withdrawal is about **3.5% of every sale**, before tax and before our own costs (Cloudinary, hosting, email, support).
- **If you switch on "customer pays the fee",** the customer is charged about price ÷ 0.975 (e.g. ≈1,026 FCFA for a 1,000 FCFA boost). You receive the full price; only the ~1% withdrawal fee remains yours. The exact rounding in this mode isn't documented, so ask.

Values were computed from the published rates, not from any real transaction.

---

## 3. Repository checks

### 3.1 Today's free limits (exact numbers, so paid tiers can be "higher than")

| Limit | Value | File |
|---|---|---|
| Image upload size / formats | 10 MB; jpg, jpeg, png, webp, gif, avif, heic, heif | `packages/shared/src/media.ts` (`MEDIA_RULES.IMAGE`) |
| Audio upload size / duration | 50 MB; 20 min; mp3, wav, m4a, aac, ogg, flac | same (`AUDIO`) |
| Video upload size / duration | 100 MB; 10 min; mp4, mov, webm, m4v | same (`VIDEO`) |
| Unconfirmed uploads at once | 20 per user | `apps/api/src/modules/media/media.service.ts` (`MAX_PENDING_PER_USER`) |
| Upload starts | 60 / hour | `apps/api/src/lib/rate-limit.ts` (`upload`) |
| Profile links | 10 | `packages/shared/src/links.ts` (`MAX_PROFILE_LINKS`) |
| Images per post | 4 | `packages/shared/src/social.ts` (`MAX_POST_IMAGES`) |
| Creative roles / genres on profile | 6 / 8 | `packages/shared/src/profile.ts` |
| Genres per portfolio item | 5 | `packages/shared/src/portfolio.ts` |
| Bio | 500 characters | `packages/shared/src/profile.ts` |
| Portfolio description / credits | 500 / 500 characters | `packages/shared/src/portfolio.ts` |
| Posts, comments, portfolio writes | 20 / min and 200 / hour | `apps/api/src/lib/rate-limit.ts` (`contentWrite`) |
| **Number of portfolio items** | **unlimited** (no cap in code) | — |
| **Total storage per user** | **unlimited** (no quota in code) | — |

### 3.2 Event tracking for analytics
- **Nothing is tracked today.** No profile views, plays, link clicks or impressions are stored in any table or log. The Cloudinary SDK's own tracking parameter is switched off (`analytics: false` in `lib/media-storage.ts`).
- **What is stored:**
  - sign-in sessions, with IP address and user agent (Better Auth `session`);
  - the IP address of staff actions (`audit_log`);
  - follower, connection, like and comment **counts**, derived from real records.
- **Privacy implications for a paid "insights" tier:**
  - Per-viewer logs (who viewed whom) are personal data: they need a lawful basis, disclosure in the Privacy notice, retention limits, and probably consent for non-essential tracking.
  - **Recommendation:** aggregated daily counters only (views, plays, link clicks per item per day), no viewer identity, no IP. Bots and self-views should be excluded.

### 3.3 Feed and Discover ordering; where a labelled "Promoted" slot fits
- **Feed** (`apps/api/src/modules/feed/feed.service.ts`): both tabs sort newest first, `[createdAt desc, id desc]` (`newestFirst`). Discover shows all visible posts; Following shows people you follow plus yourself. Cursor pagination on `id`.
- **Discover** (`apps/api/src/modules/discover/discover.service.ts`): people sorted newest account first; work sorted by `publishedAt desc`.
- **Least-change design:**
  - a **separate endpoint**, e.g. `GET /promotions/slots?surface=feed|discover&roles=&genre=`, returning 0–N active, paid, approved items;
  - the client shows them as a clearly **"Promoted"**-labelled card at a fixed position (e.g. after item 3) on **page 1 only**, and a "Spotlight" row above Discover results;
  - the organic query and its cursor stay untouched.
- **Risks:**
  - **Duplicates:** a promoted post can also appear organically. Filter promoted ids out of the visible page on the client, or accept it.
  - **Pagination:** inserting server-side into the cursor list would break cursor semantics. Keep it separate.
  - **Caching:** the client caches `me` for 60 s; feed and Discover aren't cached server-side, so slot changes appear on refetch.
  - **Fairness and labelling:** CLAUDE.md §18 requires paid content to be distinguishable, and no guaranteed engagement.
  - **Spotlight relevance:** a spotlight should respect the active filters.

### 3.4 Groundwork payments can reuse
- **Admin console:** user detail, reason dialogs, audit log, and the permission matrix (`packages/shared/src/admin.ts`). `FINANCE_ADMIN` is **deferred**; add `payments.view` / `payments.refund` permissions and a transactions page.
- **Audit log:** append-only via database triggers (`apps/api/src/lib/audit.ts`). Record refunds, manual reconciliations and price changes.
- **Outbox:** transactional, with retries, backoff and a give-up state (`apps/api/src/lib/outbox.ts`, ADR 0003). Ideal for "webhook received → verify → fulfil" and reconciliation.
- **Idempotency-Key:** middleware (`apps/api/src/middleware/idempotency.ts`). Use it for **checkout initiation**, so double-clicks don't create two payments.
- **Notifications: not built** (M4). There's no in-app receipt or "payment confirmed" message yet.
- **Email:**
  - The Resend transport works in code (`apps/api/src/lib/mailer.ts`), with templates **only for password reset and verification** (`email-templates.ts`).
  - **No domain is verified**, so no receipt or reminder can reach a real customer today.
  - A receipt template and a renewal-reminder template would be new work.

### 3.5 Are the earlier standards enforced in code?

| Standard | Status | Where |
|---|---|---|
| Server-side authorisation | **Partly central.** The staff permission matrix is central (`packages/shared/src/admin.ts`, `middleware/require-staff.ts`). Member-level object checks (owner, applicant) live in **each service**, not in one policy layer | `middleware/require-auth.ts`, services |
| Zod validation | Every body goes through `validateBody`, every query through `parseQuery` (`middleware/validate.ts`). Most input schemas **reject** unknown fields (`strict`); **`createUploadSchema` silently strips them** (safe, but not "rejected") | `packages/shared/src/*` |
| RFC 9457 errors | All `/api/v1` errors | `lib/problem.ts`, `middleware/error-handler.ts`, test `middleware/problem.test.ts` |
| Idempotency-Key | On post, comment, connection, report, opportunity create/apply; **optional** (not `required`) so far | `middleware/idempotency.ts` |
| Rate limits | Per class, with 429 + Retry-After | `lib/rate-limit.ts`, test `middleware/security.test.ts` |
| OpenAPI coverage | A drift test fails if any route is undocumented | `openapi/operations.ts`, `openapi/route-scan.ts`, `openapi/openapi.test.ts` |
| CSRF origin check | All unsafe `/api/v1` requests | `middleware/origin-check.ts` |

**Where a payment module plugs in:**
1. `apps/api/prisma/schema.prisma`: `ServiceCatalogue` (admin-editable prices, D10), `Order` (price snapshot, integer XAF, our reference), `Payment` (provider reference, status, raw verified amount and currency), `WebhookEvent` (unique event id).
2. `apps/api/src/modules/payments/`:
   - `provider.ts`: a `PaymentProvider` interface;
   - `notchpay.ts`: the adapter (`createCheckout`, `retrieve`);
   - `sandbox.ts`: a clearly labelled sandbox adapter;
   - `payments.service.ts` and `payments.routes.ts`.
3. `apps/api/src/app.ts`: mount `POST /api/v1/payments/webhooks/notchpay` with `express.raw()` **before** `express.json()`, the same pattern as Better Auth. It must be exempt from the CSRF origin check, since it's server-to-server and authenticated by HMAC.
4. `apps/api/src/config/env.ts`: optional `NOTCHPAY_*` variables already exist. The webhook hash must also be server-only; never `VITE_`.
5. `packages/shared/src/payments.ts`: schemas. `openapi/operations.ts`: entries. `lib/rate-limit.ts`: a `checkout` class.
6. `apps/web`: a checkout button (redirect to `authorization_url`), a return page that **only shows status from our API**, and an admin transactions page.

---

## 4. Questions for Notch Pay support
1. **Webhook signature:** Is the HMAC-SHA256 computed over the **exact raw request body**, or over a re-serialised JSON? Is the key the "webhook hash" (`hsk_…`, Settings → API Keys) or a per-webhook "secret"? Are they the same? Any timestamp or replay protection planned?
2. **Retries:** How many webhook retries, on what schedule, with what delivery timeout? Is ordering guaranteed? Can an event id be redelivered days later?
3. **Amounts:** Is `amount` for XAF in francs (5000 = 5,000 FCFA)? Is the same true for refunds' `amount` ("smallest currency unit")?
4. **References:** Is a duplicate `reference` rejected? Does `GET /payments/{reference}` accept our reference, yours (`trx.…` / `pay_…`), or both? On the callback, which parameter is ours, `reference` or `trxref`?
5. **Statuses:** What's the authoritative status list (`canceled` vs `cancelled`, `partialy-refunded`, `incomplete`, `abandoned`)? Is expiry always 3 hours?
6. **Keys:** Which key is required for create and retrieve, public or private? Can retrieve be restricted to the private key?
7. **Recurring:** Is there any subscription, saved-method or tokenised re-charge support, or on the roadmap?
8. **Refunds:** Which statuses and methods are refundable? Is the 90-day window firm? Is the original fee ever refunded? How are refunds tested in sandbox?
9. **Sandbox:** Is there a test number for "stays pending"? Any test cards? Sandbox rate limits?
10. **Fees:** Card fees? The exact rounding when the customer pays the fee? Which tax applies to fees, and is it shown on invoices?
11. **Payouts:** Settlement and withdrawal timing to MTN MoMo, holds or reserves, and minimum balances.
12. **Merchant onboarding:** Requirements and documents needed to activate live mode for a platform selling its own digital services.

## 5. Questions for a lawyer and an accountant
- **Lawyer:**
  - Consumer law for digital services in Cameroon (and CEMAC): pre-contract information, cancellation and refund rights for boosts, spotlights and subscriptions.
  - Terms of sale and auto-renewal rules: manual renewals avoid stored credentials, but reminders may be regulated.
  - Advertising and labelling rules for "Promoted" content.
  - Data protection: payment data, the London data location (D15), cross-border transfers, and analytics consent.
  - Minimum age 16 (D6) versus who may pay.
  - Platform liability for organiser-run opportunities and competitions.
- **Accountant:**
  - VAT/TVA on MuzikHub's sales of digital services (rate, registration threshold, who collects).
  - Tax treatment of Notch Pay fees (are they VAT-able, is the VAT recoverable?).
  - Invoicing obligations (numbered invoices, required mentions).
  - Revenue recognition for annual plans (deferred revenue) and for time-limited boosts.
  - Treatment of refunds and chargebacks, and record-keeping for the Notch Pay balance and withdrawals.
  - Whether pricing should be VAT-inclusive.

---
_End of audit. Nothing has been built or changed. Waiting for approval._
