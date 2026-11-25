/**
 * The provider boundary (ADR 0004). Everything provider-specific lives behind this interface:
 * request shapes, signing, status vocabulary and amount units. The rest of the payments module
 * (routes, state machine, fulfilment) only ever sees the normalised types below.
 */
export type NormalisedStatus =
  | 'paid'
  | 'pending'
  | 'processing'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'incomplete'
  /** Anything we don't recognise. Always treated as NOT paid. */
  | 'unknown';

export interface ProviderPayment {
  reference: string | null;
  status: NormalisedStatus;
  /** The provider's raw status string, for logs and admin review only. */
  rawStatus: string;
  /** Whole XAF, or null when the provider's value couldn't be read safely. */
  amountXaf: number | null;
  currency: string | null;
  providerTransactionId: string | null;
}

/** A webhook whose signature checked out. Still only a trigger: nothing is granted from it. */
export interface VerifiedWebhookEvent {
  eventId: string;
  type: string;
  reference: string | null;
  /** Which signing variant matched (diagnostics; never the signature itself). */
  signatureVariant: string;
}

export interface CreateCheckoutInput {
  reference: string;
  amountXaf: number;
  currency: 'XAF';
  /** The only personal data sent: the account email (listed for the privacy notice). */
  email: string;
  description: string;
  /** Built on the server from configuration, never from client input. */
  callbackUrl: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: 'fake' | 'notchpay';
  /** True for the in-process TEST PROVIDER. */
  readonly isTestProvider: boolean;
  readonly supportsRefund: boolean;
  createCheckout(input: CreateCheckoutInput): Promise<{ checkoutUrl: string; providerTransactionId: string | null }>;
  /** Server-to-provider verification. The only source of truth for "paid". */
  getPayment(reference: string): Promise<ProviderPayment>;
  cancelPayment(reference: string): Promise<void>;
  /** Present only when supportsRefund. */
  refund?(input: { reference: string; amountXaf: number; reason: string }): Promise<{ providerRefundId: string }>;
  /** Authenticates a webhook from its exact raw bytes. Throws WebhookAuthError when it doesn't. */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): VerifiedWebhookEvent;
  normaliseStatus(raw: unknown): NormalisedStatus;
}

export class WebhookAuthError extends Error {}

export const header = (headers: WebhookHeaders, name: string): string | undefined => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
