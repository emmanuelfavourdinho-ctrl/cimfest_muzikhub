import { HttpError } from '../../../lib/http-error.js';
import { WebhookAuthError, type PaymentProvider, type ProviderPayment, type VerifiedWebhookEvent } from '../provider.js';
import { mapNotchPayStatus } from './notchpay-mapping.js';

/**
 * Notch Pay adapter — STUB. Live and sandbox access are EXTERNALLY BLOCKED (owner, Phase 3): no
 * request is ever made to Notch Pay and no key is read. Every operation fails closed. The pure
 * mapping (statuses, amounts, payload shapes) is ready and tested in notchpay-mapping.ts; the
 * HTTP calls and the HMAC check (raw bytes, then re-serialised JSON, x-notch-signature, ADR 0004)
 * are written once Notch Pay answers decisions-and-risks §8.1.
 */
const blocked = () =>
  new HttpError(503, 'PAYMENTS_EXTERNALLY_BLOCKED', 'Payments with Notch Pay are not available yet. No money has been taken.');

export class NotchPayProvider implements PaymentProvider {
  readonly name = 'notchpay' as const;
  readonly isTestProvider = false;
  readonly supportsRefund = false; // until the adapter exists

  async createCheckout(): Promise<{ checkoutUrl: string; providerTransactionId: string | null }> {
    throw blocked();
  }
  async getPayment(): Promise<ProviderPayment> {
    throw blocked();
  }
  async cancelPayment(): Promise<void> {
    throw blocked();
  }
  verifyWebhook(): VerifiedWebhookEvent {
    throw new WebhookAuthError('Notch Pay webhooks are externally blocked');
  }
  normaliseStatus(raw: unknown) {
    return mapNotchPayStatus(raw);
  }
}
