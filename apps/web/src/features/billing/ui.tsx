import { FlaskConical } from 'lucide-react';
import type { OrderStatus, ProfileAccent } from '@muzikhub/shared';
import { Pill } from '@/components/ui/primitives';

export const formatXaf = (n: number) => `${new Intl.NumberFormat('fr-CM').format(n)} FCFA`;
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Mandatory on any checkout UI while PAYMENTS_MODE=sandbox (owner rule). */
export function TestPaymentsBanner() {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/15 px-4 py-3 text-small text-warning"
    >
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Test payments.</strong> Payments use a test provider: no real money moves, and nothing here is a real purchase yet.
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Waiting for payment',
  PROCESSING: 'Processing',
  FULFILMENT_PENDING: 'Activating',
  FULFILLED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  NEEDS_REVIEW: 'Being checked',
  REFUNDED: 'Refunded',
};
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const variant = status === 'FULFILLED' ? 'signal' : status === 'NEEDS_REVIEW' || status === 'REFUNDED' ? 'gold' : 'gray';
  return <Pill variant={variant}>{STATUS_LABEL[status]}</Pill>;
}
export const FINAL_ORDER_STATUSES = new Set<OrderStatus>(['FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'NEEDS_REVIEW', 'REFUNDED']);

/** Approved palette roles for profile accents (static class names so Tailwind keeps them). */
export const ACCENT_RING: Record<ProfileAccent, string> = {
  LIME: 'ring-signal',
  GOLD: 'ring-warning',
  VIOLET: 'ring-violet',
  SKY: 'ring-info',
  MINT: 'ring-success',
};
export const ACCENT_BAR: Record<ProfileAccent, string> = {
  LIME: 'bg-signal',
  GOLD: 'bg-warning',
  VIOLET: 'bg-violet',
  SKY: 'bg-info',
  MINT: 'bg-success',
};
