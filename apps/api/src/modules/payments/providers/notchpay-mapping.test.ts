import { describe, expect, it } from 'vitest';
import { NotchPayProvider } from './notchpay.js';
import {
  mapNotchPayStatus,
  NOTCHPAY_STATUS_MAP,
  notchPayAmountToXaf,
  parseNotchPayPayment,
  parseNotchPayWebhookEvent,
  xafToNotchPayAmount,
} from './notchpay-mapping.js';

describe('Notch Pay status mapping (documented values only)', () => {
  it.each([
    ['complete', 'paid'],
    ['pending', 'pending'],
    ['processing', 'processing'],
    ['failed', 'failed'],
    ['rejected', 'failed'],
    ['canceled', 'cancelled'],
    ['cancelled', 'cancelled'],
    ['abandoned', 'cancelled'],
    ['expired', 'expired'],
    ['refunded', 'refunded'],
    ['partialy-refunded', 'partially_refunded'],
    ['partially-refunded', 'partially_refunded'],
    ['incomplete', 'incomplete'],
  ])('%s → %s', (raw, expected) => {
    expect(mapNotchPayStatus(raw)).toBe(expected);
  });

  it.each([['Complete'], ['COMPLETE'], [' complete'], ['completed'], ['success'], ['paid'], [''], ['toString'], ['__proto__']])(
    'unrecognised %j → unknown (never paid)',
    (raw) => {
      expect(mapNotchPayStatus(raw)).toBe('unknown');
    },
  );

  it('non-strings are unknown', () => {
    for (const v of [null, undefined, 1, true, {}, ['complete']]) expect(mapNotchPayStatus(v)).toBe('unknown');
  });

  it('only "complete" maps to paid', () => {
    expect(Object.entries(NOTCHPAY_STATUS_MAP).filter(([, v]) => v === 'paid')).toEqual([['complete', 'paid']]);
  });
});

describe('amount units (single conversion point, UNVERIFIED semantics)', () => {
  it('accepts positive whole francs only', () => {
    expect(notchPayAmountToXaf(5000)).toBe(5000);
    for (const v of [0, -5, 50.5, '5000', null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(notchPayAmountToXaf(v)).toBeNull();
  });
  it('sends whole francs and refuses anything else', () => {
    expect(xafToNotchPayAmount(2500)).toBe(2500);
    expect(() => xafToNotchPayAmount(0)).toThrow();
    expect(() => xafToNotchPayAmount(99.9)).toThrow();
  });
});

describe('documented payload shapes', () => {
  it('GET /payments/{reference} → normalised payment', () => {
    const json = {
      status: 'OK',
      code: 200,
      transaction: { id: 'pay_123', reference: 'mh_abc', amount: 2500, currency: 'XAF', status: 'complete' },
    };
    expect(parseNotchPayPayment(json)).toEqual({
      reference: 'mh_abc',
      status: 'paid',
      rawStatus: 'complete',
      amountXaf: 2500,
      currency: 'XAF',
      providerTransactionId: 'pay_123',
    });
  });
  it('malformed or missing fields never become paid', () => {
    expect(parseNotchPayPayment(null).status).toBe('unknown');
    expect(parseNotchPayPayment({}).status).toBe('unknown');
    const odd = parseNotchPayPayment({ transaction: { reference: 'mh_abc', amount: '2500', status: 'complete' } });
    expect(odd.amountXaf).toBeNull(); // can't match the order → not fulfilled
  });
  it('webhook event object (type, or event for disputes)', () => {
    expect(parseNotchPayWebhookEvent({ id: 'evt_1', type: 'payment.complete', data: { reference: 'mh_abc' } })).toEqual({
      eventId: 'evt_1',
      type: 'payment.complete',
      reference: 'mh_abc',
    });
    expect(parseNotchPayWebhookEvent({ id: 'evt_2', event: 'dispute.created', data: {} })?.type).toBe('dispute.created');
    expect(parseNotchPayWebhookEvent({ type: 'payment.complete' })).toBeNull();
  });
});

describe('Notch Pay adapter stub fails closed', () => {
  const np = new NotchPayProvider();
  it('every network operation is externally blocked', async () => {
    await expect(np.createCheckout()).rejects.toMatchObject({ status: 503, code: 'PAYMENTS_EXTERNALLY_BLOCKED' });
    await expect(np.getPayment()).rejects.toMatchObject({ code: 'PAYMENTS_EXTERNALLY_BLOCKED' });
    await expect(np.cancelPayment()).rejects.toMatchObject({ code: 'PAYMENTS_EXTERNALLY_BLOCKED' });
    expect(np.supportsRefund).toBe(false);
  });
  it('no webhook is ever accepted', () => {
    expect(() => np.verifyWebhook()).toThrow(/externally blocked/);
  });
});
