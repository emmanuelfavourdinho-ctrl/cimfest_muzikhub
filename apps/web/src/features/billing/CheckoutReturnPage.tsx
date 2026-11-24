import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { billingApi, billingKeys } from '@/lib/billing';
import { FINAL_ORDER_STATUSES, formatXaf, OrderStatusPill, TestPaymentsBanner } from './ui';

/**
 * /checkout/return — where the provider sends the customer back. Shows ONLY our own order status
 * from the API (the redirect's query parameters are never trusted), refreshing until final.
 */
export function CheckoutReturnPage() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: billingKeys.order(reference),
    queryFn: () => billingApi.order(reference),
    enabled: reference.length > 0,
    refetchInterval: (q) => (q.state.data && FINAL_ORDER_STATUSES.has(q.state.data.status) ? false : 2000),
  });
  if (!reference)
    return <EmptyState title="No order here">This link has no order reference. Your payments are listed under Billing.</EmptyState>;
  if (order.isPending) return <PageLoading />;
  if (order.isError) return <LoadFailed message={errorMessage(order.error)} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const done = FINAL_ORDER_STATUSES.has(o.status);
  if (o.status === 'FULFILLED') void qc.invalidateQueries({ queryKey: ['billing'] });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Payment" title="Your order" />
      {o.mode === 'SANDBOX' && <TestPaymentsBanner />}
      <Panel className="p-5" aria-label="Order status">
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusPill status={o.status} />
          {!done && (
            <span className="text-caption text-text-3" role="status">
              Checking with the provider…
            </span>
          )}
        </div>
        <p className="mt-3 text-body text-text-1">{o.statusMessage}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small text-text-2">
          <dt>Item</dt>
          <dd>
            {o.product}, {o.option}
          </dd>
          <dt>Amount</dt>
          <dd>{formatXaf(o.amountXaf)}</dd>
          <dt>Reference</dt>
          <dd className="break-all">{o.reference}</dd>
        </dl>
      </Panel>
      <div className="mt-4 flex flex-wrap gap-2">
        {o.status === 'PENDING' && o.checkoutUrl && (
          <Button asChild>
            <a href={o.checkoutUrl}>Continue to payment</a>
          </Button>
        )}
        {o.status === 'PENDING' && (
          <Button
            variant="outline"
            onClick={async () => {
              await billingApi.cancelOrder(reference);
              await qc.invalidateQueries({ queryKey: billingKeys.order(reference) });
            }}
          >
            Cancel order
          </Button>
        )}
        {done && (
          <Button asChild variant={o.status === 'FULFILLED' ? 'primary' : 'outline'}>
            <Link to={`/billing/orders/${encodeURIComponent(o.reference)}`}>View receipt</Link>
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link to="/settings/billing">Go to billing</Link>
        </Button>
      </div>
    </div>
  );
}
