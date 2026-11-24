import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  header,
  WebhookAuthError,
  type CreateCheckoutInput,
  type NormalisedStatus,
  type PaymentProvider,
  type ProviderPayment,
  type VerifiedWebhookEvent,
  type WebhookHeaders,
} from '../provider.js';

/**
 * TEST PROVIDER — an in-process stand-in for a payment provider, used by automated tests and the
 * development-only sandbox page. It moves no money and talks to nothing. Refused in production
 * (config/env.ts and createProvider). Its webhook scheme is its OWN, deliberately different from
 * Notch Pay's: header `x-test-provider-signature: v1=<hex HMAC-SHA256(secret, raw body)>`.
 */
export const TEST_PROVIDER_SIGNATURE_HEADER = 'x-test-provider-signature';
const STATUSES: readonly NormalisedStatus[] = [
  'paid',
  'pending',
  'processing',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'incomplete',
];
const log = (msg: string) => console.info(`[TEST PROVIDER] ${msg}`);
const id = (kind: string) => `TEST-PROVIDER-${kind}_${randomBytes(8).toString('hex')}`;

type FakePayment = { status: string; amountXaf: number; currency: string; trx: string };

export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly isTestProvider = true;
  readonly supportsRefund: boolean;
  /** Visible for tests: what the fake "provider" currently holds. */
  readonly payments = new Map<string, FakePayment>();
  readonly calls: { method: string; reference: string }[] = [];
  private readonly secret: Buffer;
  private readonly checkoutBaseUrl: string;
  /** Tests: make the next createCheckout fail like a provider outage. */
  failNextCheckout = false;

  constructor(opts: { checkoutBaseUrl: string; supportsRefund?: boolean; secret?: Buffer }) {
    this.checkoutBaseUrl = opts.checkoutBaseUrl;
    this.supportsRefund = opts.supportsRefund ?? true;
    this.secret = opts.secret ?? randomBytes(32);
  }

  async createCheckout(input: CreateCheckoutInput) {
    this.calls.push({ method: 'createCheckout', reference: input.reference });
    if (this.failNextCheckout) {
      this.failNextCheckout = false;
      throw new Error('TEST PROVIDER: simulated outage');
    }
    const trx = id('trx');
    this.payments.set(input.reference, { status: 'pending', amountXaf: input.amountXaf, currency: input.currency, trx });
    log(`checkout created ref=${input.reference} trx=${trx}`);
    const url = new URL(this.checkoutBaseUrl);
    url.searchParams.set('reference', input.reference);
    return { checkoutUrl: url.toString(), providerTransactionId: trx };
  }

  async getPayment(reference: string): Promise<ProviderPayment> {
    this.calls.push({ method: 'getPayment', reference });
    const p = this.payments.get(reference);
    if (!p) return { reference, status: 'unknown', rawStatus: 'not_found', amountXaf: null, currency: null, providerTransactionId: null };
    return {
      reference,
      status: this.normaliseStatus(p.status),
      rawStatus: p.status,
      amountXaf: p.amountXaf,
      currency: p.currency,
      providerTransactionId: p.trx,
    };
  }

  async cancelPayment(reference: string) {
    this.calls.push({ method: 'cancelPayment', reference });
    const p = this.payments.get(reference);
    if (p && p.status === 'pending') p.status = 'cancelled';
    log(`cancel ref=${reference}`);
  }

  async refund(input: { reference: string; amountXaf: number; reason: string }) {
    this.calls.push({ method: 'refund', reference: input.reference });
    if (!this.supportsRefund) throw new Error('TEST PROVIDER: refunds not supported');
    const p = this.payments.get(input.reference);
    if (!p || p.status !== 'paid') throw new Error('TEST PROVIDER: payment is not refundable');
    p.status = 'refunded';
    log(`refund ref=${input.reference}`);
    return { providerRefundId: id('rfd') };
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): VerifiedWebhookEvent {
    const sig = header(headers, TEST_PROVIDER_SIGNATURE_HEADER);
    const m = sig?.match(/^v1=([0-9a-f]{64})$/);
    if (!m) throw new WebhookAuthError('missing or malformed TEST PROVIDER signature');
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    const given = Buffer.from(m[1]!, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new WebhookAuthError('bad TEST PROVIDER signature');
    let body: { id?: unknown; type?: unknown; data?: { reference?: unknown } };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookAuthError('signed body is not JSON');
    }
    if (typeof body.id !== 'string' || typeof body.type !== 'string') throw new WebhookAuthError('event id or type missing');
    return {
      eventId: body.id,
      type: body.type,
      reference: typeof body.data?.reference === 'string' ? body.data.reference : null,
      signatureVariant: 'test-provider-v1',
    };
  }

  normaliseStatus(raw: unknown): NormalisedStatus {
    return typeof raw === 'string' && (STATUSES as readonly string[]).includes(raw) ? (raw as NormalisedStatus) : 'unknown';
  }

  // ── Test and development controls (not part of PaymentProvider) ──

  /** Sets what the "provider" will report for a payment (any string; unknown ones stay unpaid). */
  settle(reference: string, status: string, overrides: { amountXaf?: number; currency?: string } = {}) {
    const p = this.payments.get(reference);
    if (!p) throw new Error(`TEST PROVIDER: no payment ${reference}`);
    Object.assign(p, { status }, overrides);
    log(`settled ref=${reference} status=${status}`);
  }

  sign(rawBody: Buffer) {
    return `v1=${createHmac('sha256', this.secret).update(rawBody).digest('hex')}`;
  }

  /** A correctly signed webhook body + headers, as the provider would send. */
  signedWebhook(reference: string, type = 'payment.updated', eventId = id('evt')) {
    const body = Buffer.from(JSON.stringify({ id: eventId, type, data: { reference } }));
    return { body, headers: { 'content-type': 'application/json', [TEST_PROVIDER_SIGNATURE_HEADER]: this.sign(body) }, eventId };
  }
}
