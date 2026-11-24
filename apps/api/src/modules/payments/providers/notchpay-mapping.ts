import type { NormalisedStatus, ProviderPayment } from '../provider.js';

/**
 * Notch Pay ↔ MuzikHub mapping, built ONLY from the documented payload shapes
 * (docs/monetization-audit.md §1.2–1.4). No network code here. Unit-tested.
 *
 * STATUS: the OpenAPI spec has no status enum; the two doc pages list different values. Every
 * value is mapped explicitly; anything else (including different spelling or case) is "unknown",
 * which the state machine treats as NOT PAID.
 */
export const NOTCHPAY_STATUS_MAP: Readonly<Record<string, NormalisedStatus>> = {
  complete: 'paid',
  pending: 'pending',
  processing: 'processing',
  failed: 'failed',
  rejected: 'failed',
  canceled: 'cancelled', // Payments API spelling
  cancelled: 'cancelled', // defensive: British spelling
  abandoned: 'cancelled', // Collect page: customer left the checkout; nothing paid
  expired: 'expired',
  refunded: 'refunded',
  'partialy-refunded': 'partially_refunded', // sic — documented spelling
  'partially-refunded': 'partially_refunded', // defensive: corrected spelling
  incomplete: 'incomplete', // paid LESS than the amount: never fulfilled, goes to review
};

export function mapNotchPayStatus(raw: unknown): NormalisedStatus {
  if (typeof raw !== 'string') return 'unknown';
  return Object.hasOwn(NOTCHPAY_STATUS_MAP, raw) ? NOTCHPAY_STATUS_MAP[raw]! : 'unknown';
}

/*
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║ AMOUNT UNITS — UNVERIFIED (audit questions 3 and 4).                                    ║
 * ║ We ASSUME Notch Pay's `amount` for XAF is whole francs (5000 = 5,000 FCFA), because XAF ║
 * ║ has no minor unit and the examples suggest it; the Refunds page says "smallest currency ║
 * ║ unit", which could mean the same thing or not. This is the ONLY place units convert.    ║
 * ║ Confirm with Notch Pay before live mode. Until then, anything that isn't a positive    ║
 * ║ whole number fails closed (null → the payment can't match an order → not fulfilled).    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 */
export function notchPayAmountToXaf(amount: unknown): number | null {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
export function xafToNotchPayAmount(xaf: number): number {
  if (!Number.isSafeInteger(xaf) || xaf <= 0) throw new Error('XAF amounts are positive whole francs');
  return xaf;
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null);

/**
 * `GET /payments/{reference}` → `{ transaction: { id, reference, amount, currency, status, … } }`
 * (Payments API → "Retrieve a Payment"). Missing or odd fields → unknown / null, never "paid".
 */
export function parseNotchPayPayment(json: unknown): ProviderPayment {
  const t = (json as { transaction?: Record<string, unknown> } | null)?.transaction;
  if (!t || typeof t !== 'object') {
    return { reference: null, status: 'unknown', rawStatus: 'malformed', amountXaf: null, currency: null, providerTransactionId: null };
  }
  return {
    reference: str(t.reference),
    status: mapNotchPayStatus(t.status),
    rawStatus: typeof t.status === 'string' ? t.status.slice(0, 40) : 'missing',
    amountXaf: notchPayAmountToXaf(t.amount),
    currency: str(t.currency),
    providerTransactionId: str(t.id),
  };
}

/**
 * Webhook event object `{ id, type, created_at, data: { reference, … } }` (Webhooks API →
 * "Webhook Event Object"); dispute events use `event` instead of `type`.
 */
export function parseNotchPayWebhookEvent(json: unknown): { eventId: string; type: string; reference: string | null } | null {
  const e = json as { id?: unknown; type?: unknown; event?: unknown; data?: { reference?: unknown } } | null;
  const eventId = str(e?.id);
  const type = str(e?.type) ?? str(e?.event);
  if (!eventId || !type) return null;
  return { eventId, type, reference: str(e?.data?.reference) };
}
