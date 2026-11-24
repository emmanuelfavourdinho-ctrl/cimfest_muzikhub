import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { billingApi, billingKeys } from '@/lib/billing';
import { formatDate, formatDateTime, formatXaf, OrderStatusPill, TestPaymentsBanner } from './ui';

/** /billing/orders/:reference — on-screen receipt (no emailed receipts until the domain is verified). */
export function ReceiptPage() {
  const { reference = '' } = useParams();
  const q = useQuery({ queryKey: [...billingKeys.order(reference), 'receipt'], queryFn: () => billingApi.receipt(reference) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const rows: [string, string][] = [
    ['Item', `${r.product}, ${r.option}`],
    ['Amount', formatXaf(r.amountXaf)],
    ['Ordered', formatDateTime(r.createdAt)],
    ...(r.paidAt ? ([['Paid', formatDateTime(r.paidAt)]] as [string, string][]) : []),
    ...(r.granted ? ([[r.granted.label, `${formatDate(r.granted.from)} to ${formatDate(r.granted.to)}`]] as [string, string][]) : []),
    ...(r.refundedAt ? ([['Refunded', formatDateTime(r.refundedAt)]] as [string, string][]) : []),
    ['Payment provider', r.provider],
    ['Reference', r.reference],
  ];
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Receipt" title={r.status === 'FULFILLED' ? 'Payment received' : 'Order details'} />
      {r.mode === 'SANDBOX' && <TestPaymentsBanner />}
      <Panel className="p-5">
        <OrderStatusPill status={r.status as OrderStatus} />
        <p className="mt-3 text-small text-text-1">{r.statusMessage}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-2">{k}</dt>
              <dd className="break-all text-text-1">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-caption text-text-3">This on-screen receipt is your record. We don’t send email receipts yet.</p>
      </Panel>
      <Button asChild variant="ghost" className="mt-4">
        <Link to="/settings/billing">Back to billing</Link>
      </Button>
    </div>
  );
}
