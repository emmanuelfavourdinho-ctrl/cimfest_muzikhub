import type { OrderStatus } from '@muzikhub/shared';
import type { ProviderPayment } from './provider.js';

/**
 * The order state machine — single source of truth, mirrored in docs/payments-state-machine.md
 * (a test checks the two agree). Pure: no I/O. Anything not listed is not allowed.
 */
export type Trigger =
  | 'provider.processing'
  | 'provider.paid'
  | 'provider.paid_late'
  | 'provider.mismatch'
  | 'provider.incomplete'
  | 'provider.failed'
  | 'provider.cancelled'
  | 'provider.expired'
  | 'provider.refunded_externally'
  | 'system.expire'
  | 'member.cancel'
  | 'fulfilment.done'
  | 'fulfilment.impossible'
  | 'admin.refund';

export interface Transition {
  from: readonly OrderStatus[];
  to: OrderStatus;
  trigger: Trigger;
  who: string;
  effects: string;
}

const OPEN = ['PENDING', 'PROCESSING'] as const;
const CLOSED_UNPAID = ['FAILED', 'CANCELLED', 'EXPIRED'] as const;

export const TRANSITIONS: readonly Transition[] = [
  { from: ['PENDING'], to: 'PROCESSING', trigger: 'provider.processing', who: 'provider (verified)', effects: 'none' },
  {
    from: OPEN,
    to: 'FULFILMENT_PENDING',
    trigger: 'provider.paid',
    who: 'provider (verified)',
    effects: 'paidAt = database now; enqueue payments.fulfil',
  },
  {
    from: [...OPEN, ...CLOSED_UNPAID],
    to: 'NEEDS_REVIEW',
    trigger: 'provider.paid_late',
    who: 'provider (verified)',
    effects: 'paidAt set; never fulfilled automatically; admin review',
  },
  {
    from: [...OPEN, ...CLOSED_UNPAID],
    to: 'NEEDS_REVIEW',
    trigger: 'provider.mismatch',
    who: 'provider (verified)',
    effects: 'amount, currency or reference differs from the order; admin review',
  },
  {
    from: OPEN,
    to: 'NEEDS_REVIEW',
    trigger: 'provider.incomplete',
    who: 'provider (verified)',
    effects: 'paid less than the amount; admin review',
  },
  { from: OPEN, to: 'FAILED', trigger: 'provider.failed', who: 'provider (verified)', effects: 'none' },
  { from: OPEN, to: 'CANCELLED', trigger: 'provider.cancelled', who: 'provider (verified)', effects: 'none' },
  { from: OPEN, to: 'EXPIRED', trigger: 'provider.expired', who: 'provider (verified)', effects: 'none' },
  {
    from: OPEN,
    to: 'EXPIRED',
    trigger: 'system.expire',
    who: 'reconciliation (database time ≥ expiresAt, provider not paid)',
    effects: 'none',
  },
  { from: ['PENDING'], to: 'CANCELLED', trigger: 'member.cancel', who: 'order owner', effects: 'provider cancelPayment' },
  {
    from: ['FULFILMENT_PENDING', 'FULFILLED'],
    to: 'NEEDS_REVIEW',
    trigger: 'provider.refunded_externally',
    who: 'provider (verified)',
    effects: 'refund made outside MuzikHub; admin review',
  },
  {
    from: ['FULFILMENT_PENDING'],
    to: 'FULFILLED',
    trigger: 'fulfilment.done',
    who: 'fulfilment job',
    effects: 'same transaction: fulfilment record (unique per order) + entitlement',
  },
  {
    from: ['FULFILMENT_PENDING'],
    to: 'NEEDS_REVIEW',
    trigger: 'fulfilment.impossible',
    who: 'fulfilment job',
    effects: 'paid, but the target can no longer receive it (e.g. the post was removed); nothing granted; admin review',
  },
  {
    from: ['FULFILMENT_PENDING', 'FULFILLED', 'NEEDS_REVIEW'],
    to: 'REFUNDED',
    trigger: 'admin.refund',
    who: 'ADMIN (payments.refund, fresh session, reason)',
    effects: 'provider refund; entitlement → REFUNDED; audit; provider fee not refunded',
  },
];

/** The next status, or null when the trigger isn't allowed from this status (a no-op or an error, per caller). */
export function nextStatus(from: OrderStatus, trigger: Trigger): OrderStatus | null {
  return TRANSITIONS.find((t) => t.trigger === trigger && t.from.includes(from))?.to ?? null;
}

/**
 * Turns a VERIFIED provider answer into a trigger. null = nothing to do (still pending, or an
 * unknown status, which is never treated as paid).
 */
export function triggerFromProvider(
  order: { reference: string; amountXaf: number; currency: string; status: OrderStatus; expiresAt: Date },
  payment: ProviderPayment,
  dbNow: Date,
): Trigger | null {
  switch (payment.status) {
    case 'paid': {
      const matches = payment.reference === order.reference && payment.amountXaf === order.amountXaf && payment.currency === order.currency;
      if (!matches) return 'provider.mismatch';
      const late = dbNow >= order.expiresAt || (CLOSED_UNPAID as readonly OrderStatus[]).includes(order.status);
      return late ? 'provider.paid_late' : 'provider.paid';
    }
    case 'processing':
      return 'provider.processing';
    case 'failed':
      return 'provider.failed';
    case 'cancelled':
      return 'provider.cancelled';
    case 'expired':
      return 'provider.expired';
    case 'incomplete':
      return 'provider.incomplete';
    case 'refunded':
    case 'partially_refunded':
      return 'provider.refunded_externally';
    case 'pending':
    case 'unknown':
      return null;
  }
}
