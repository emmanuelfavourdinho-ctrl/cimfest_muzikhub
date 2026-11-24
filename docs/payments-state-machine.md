# Payments: order state machine

_Phase 3, 2026-11-24. Source of truth: `apps/api/src/modules/payments/state-machine.ts`. A test fails if this table and the code disagree, and another test checks every status × trigger pair (135 cases), valid and invalid._

## States

| State | Meaning | Final? |
|---|---|---|
| `PENDING` | Order created; waiting for the customer to pay on the provider's page. | No |
| `PROCESSING` | The provider says the payment is in progress. | No |
| `FULFILMENT_PENDING` | Payment **verified with the provider** (status, amount, currency and reference all match). The benefit hasn't been granted yet. The outbox retries until it is. | No |
| `FULFILLED` | Benefit granted. The fulfilment record and the status change were committed together. | Yes (refundable) |
| `FAILED` | The provider reported a failure, or we could not start the checkout. Nothing was charged. | Yes* |
| `CANCELLED` | Cancelled by the customer, or by the provider (`canceled`, `cancelled`, `abandoned`). | Yes* |
| `EXPIRED` | Our time limit (3 h, database time) passed without a verified payment, or the provider reported `expired`. | Yes* |
| `NEEDS_REVIEW` | Money may have moved, but we can't act on it automatically: a late success, an amount/currency/reference mismatch, a partial payment (`incomplete`), a refund made outside MuzikHub, or a paid promotion whose target can no longer receive it (e.g. the post was removed). **Never fulfilled automatically.** An admin decides: refund, or, only for a late success the provider re-confirms at that moment, approve fulfilment. | No (admin) |
| `REFUNDED` | Refunded by an admin through MuzikHub. The related entitlement period is marked `REFUNDED`, so it grants nothing. The provider's original fee is not returned. | Yes |

\* The only way out of FAILED, CANCELLED and EXPIRED is to NEEDS_REVIEW, if the provider later verifies a payment. **An expired order can never be fulfilled afterwards.**

## Transitions

Anything not listed is rejected. Provider events that don't apply are ignored, because they can arrive late or out of order. A member or admin action that doesn't apply gets a 409.

| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| PENDING | PROCESSING | `provider.processing` | provider (verified) | none |
| PENDING, PROCESSING | FULFILMENT_PENDING | `provider.paid` | provider (verified) | paidAt = database now; enqueue payments.fulfil |
| PENDING, PROCESSING, FAILED, CANCELLED, EXPIRED | NEEDS_REVIEW | `provider.paid_late` | provider (verified) | paidAt set; never fulfilled automatically; admin review |
| PENDING, PROCESSING, FAILED, CANCELLED, EXPIRED | NEEDS_REVIEW | `provider.mismatch` | provider (verified) | amount, currency or reference differs from the order; admin review |
| PENDING, PROCESSING | NEEDS_REVIEW | `provider.incomplete` | provider (verified) | paid less than the amount; admin review |
| PENDING, PROCESSING | FAILED | `provider.failed` | provider (verified) | none |
| PENDING, PROCESSING | CANCELLED | `provider.cancelled` | provider (verified) | none |
| PENDING, PROCESSING | EXPIRED | `provider.expired` | provider (verified) | none |
| PENDING, PROCESSING | EXPIRED | `system.expire` | reconciliation (database time ≥ expiresAt, provider not paid) | none |
| PENDING | CANCELLED | `member.cancel` | order owner | provider cancelPayment |
| FULFILMENT_PENDING, FULFILLED | NEEDS_REVIEW | `provider.refunded_externally` | provider (verified) | refund made outside MuzikHub; admin review |
| FULFILMENT_PENDING | FULFILLED | `fulfilment.done` | fulfilment job | same transaction: fulfilment record (unique per order) + entitlement |
| FULFILMENT_PENDING | NEEDS_REVIEW | `fulfilment.impossible` | fulfilment job | paid, but the target can no longer receive it (e.g. the post was removed); nothing granted; admin review |
| NEEDS_REVIEW | FULFILMENT_PENDING | `admin.approve_late` | ADMIN (payments.repair, fresh session, reason) | only a late success the provider re-confirms now (paid, same amount, currency and reference); enqueue payments.fulfil; audit |
| FULFILMENT_PENDING, FULFILLED, NEEDS_REVIEW | REFUNDED | `admin.refund` | ADMIN (payments.refund, fresh session, reason) | provider refund; entitlement → REFUNDED; audit; provider fee not refunded |

The order is also created in `PENDING` by `member.checkout` (owner, Idempotency-Key required).

## How a provider answer becomes a trigger

"Verified" means our server asked the provider (`getPayment`), never that a webhook or browser said so.

| Provider status (normalised) | Trigger |
|---|---|
| `paid`, with amount, currency (`XAF`) and reference all equal to the order, before `expiresAt`, and the order still open | `provider.paid` |
| `paid`, but at or after `expiresAt`, or the order is already FAILED, CANCELLED or EXPIRED | `provider.paid_late` |
| `paid`, but the amount, currency or reference differs, or the amount is unreadable | `provider.mismatch` |
| `processing` / `failed` / `cancelled` / `expired` / `incomplete` | the matching trigger |
| `refunded` / `partially_refunded` | `provider.refunded_externally` |
| `pending`, or **anything unknown** | none: the order stays as it is (**not paid**) |

The provider-specific mapping (Notch Pay → normalised) is in ADR 0004 and `providers/notchpay-mapping.ts`.

## Guarantees and how they're enforced

- **No double processing.** Every change locks the order row (`SELECT … FOR UPDATE`) and does a compare-and-set on the current status. An `OrderEvent` row records each change.
- **No double fulfilment.** The fulfilment row is unique per (order, fulfiller) and is committed in the same transaction as `FULFILMENT_PENDING → FULFILLED`. If a fulfiller fails, the whole transaction rolls back and the outbox retries. Reconciliation re-queues stalled fulfilments after 10 minutes.
- **Times** (`createdAt`, `expiresAt`, `paidAt`, `fulfilledAt`, `refundedAt`) come from the **database clock**.
- **Sandbox orders** (`mode = SANDBOX`) are excluded from every revenue query, permanently.
