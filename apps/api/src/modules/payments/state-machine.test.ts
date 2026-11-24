import { readFileSync } from 'node:fs';
import { ORDER_STATUSES, type OrderStatus } from '@muzikhub/shared';
import { describe, expect, it } from 'vitest';
import type { ProviderPayment } from './provider.js';
import { nextStatus, TRANSITIONS, triggerFromProvider, type Trigger } from './state-machine.js';

const TRIGGERS: Trigger[] = [
  'provider.processing',
  'provider.paid',
  'provider.paid_late',
  'provider.mismatch',
  'provider.incomplete',
  'provider.failed',
  'provider.cancelled',
  'provider.expired',
  'provider.refunded_externally',
  'system.expire',
  'member.cancel',
  'fulfilment.done',
  'admin.refund',
];

/** The full expected table, written out independently of TRANSITIONS. Missing = invalid. */
const EXPECTED: Partial<Record<OrderStatus, Partial<Record<Trigger, OrderStatus>>>> = {
  PENDING: {
    'provider.processing': 'PROCESSING',
    'provider.paid': 'FULFILMENT_PENDING',
    'provider.paid_late': 'NEEDS_REVIEW',
    'provider.mismatch': 'NEEDS_REVIEW',
    'provider.incomplete': 'NEEDS_REVIEW',
    'provider.failed': 'FAILED',
    'provider.cancelled': 'CANCELLED',
    'provider.expired': 'EXPIRED',
    'system.expire': 'EXPIRED',
    'member.cancel': 'CANCELLED',
  },
  PROCESSING: {
    'provider.paid': 'FULFILMENT_PENDING',
    'provider.paid_late': 'NEEDS_REVIEW',
    'provider.mismatch': 'NEEDS_REVIEW',
    'provider.incomplete': 'NEEDS_REVIEW',
    'provider.failed': 'FAILED',
    'provider.cancelled': 'CANCELLED',
    'provider.expired': 'EXPIRED',
    'system.expire': 'EXPIRED',
  },
  FULFILMENT_PENDING: { 'fulfilment.done': 'FULFILLED', 'admin.refund': 'REFUNDED', 'provider.refunded_externally': 'NEEDS_REVIEW' },
  FULFILLED: { 'admin.refund': 'REFUNDED', 'provider.refunded_externally': 'NEEDS_REVIEW' },
  FAILED: { 'provider.paid_late': 'NEEDS_REVIEW', 'provider.mismatch': 'NEEDS_REVIEW' },
  CANCELLED: { 'provider.paid_late': 'NEEDS_REVIEW', 'provider.mismatch': 'NEEDS_REVIEW' },
  EXPIRED: { 'provider.paid_late': 'NEEDS_REVIEW', 'provider.mismatch': 'NEEDS_REVIEW' },
  NEEDS_REVIEW: { 'admin.refund': 'REFUNDED' },
  REFUNDED: {},
};

describe('order state machine: every (status, trigger) pair', () => {
  const cases = ORDER_STATUSES.flatMap((from) => TRIGGERS.map((t) => [from, t, EXPECTED[from]?.[t] ?? null] as const));
  it(`covers ${ORDER_STATUSES.length} × ${TRIGGERS.length} = ${cases.length} pairs`, () => expect(cases).toHaveLength(117));
  it.each(cases)('%s + %s → %s', (from, trigger, to) => {
    expect(nextStatus(from, trigger)).toBe(to);
  });
  it('REFUNDED is terminal; FULFILLED can only be refunded or flagged', () => {
    expect(TRIGGERS.map((t) => nextStatus('REFUNDED', t)).every((x) => x === null)).toBe(true);
  });
  it('nothing ever reaches FULFILLED except through fulfilment', () => {
    expect(TRANSITIONS.filter((t) => t.to === 'FULFILLED').map((t) => t.trigger)).toEqual(['fulfilment.done']);
  });
});

describe('provider answers → triggers', () => {
  const order = {
    reference: 'mh_x',
    amountXaf: 1000,
    currency: 'XAF',
    status: 'PENDING' as OrderStatus,
    expiresAt: new Date('2026-12-01T03:00:00Z'),
  };
  const before = new Date('2026-12-01T01:00:00Z');
  const after = new Date('2026-12-01T03:00:00Z'); // exactly at expiry counts as expired
  const pay = (p: Partial<ProviderPayment>): ProviderPayment => ({
    reference: 'mh_x',
    status: 'paid',
    rawStatus: 'complete',
    amountXaf: 1000,
    currency: 'XAF',
    providerTransactionId: null,
    ...p,
  });
  it('paid and matching, before expiry → paid', () => expect(triggerFromProvider(order, pay({}), before)).toBe('provider.paid'));
  it('paid at/after our expiry → paid_late', () => expect(triggerFromProvider(order, pay({}), after)).toBe('provider.paid_late'));
  it('paid on an already-closed order → paid_late', () =>
    expect(triggerFromProvider({ ...order, status: 'CANCELLED' }, pay({}), before)).toBe('provider.paid_late'));
  it.each([[{ amountXaf: 999 }], [{ amountXaf: null }], [{ currency: 'EUR' }], [{ currency: null }], [{ reference: 'mh_other' }]])(
    'paid but %j differs → mismatch',
    (diff) => expect(triggerFromProvider(order, pay(diff), before)).toBe('provider.mismatch'),
  );
  it('pending and unknown → nothing (not paid)', () => {
    expect(triggerFromProvider(order, pay({ status: 'pending' }), before)).toBeNull();
    expect(triggerFromProvider(order, pay({ status: 'unknown', rawStatus: 'weird' }), before)).toBeNull();
  });
  it('partial refunds and refunds count as external refunds', () => {
    expect(triggerFromProvider(order, pay({ status: 'partially_refunded' }), before)).toBe('provider.refunded_externally');
  });
});

describe('docs/payments-state-machine.md matches the code', () => {
  const doc = readFileSync(new URL('../../../../../docs/payments-state-machine.md', import.meta.url), 'utf8');
  it.each(TRANSITIONS.map((t) => [t.trigger, t.to, t] as const))('documents %s → %s', (_trigger, _to, t) => {
    expect(doc).toContain(`| ${t.from.join(', ')} | ${t.to} | \`${t.trigger}\` | ${t.who} | ${t.effects} |`);
  });
});
