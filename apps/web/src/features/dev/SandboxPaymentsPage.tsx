import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { checkoutResultSchema, orderViewSchema, type OrderView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatXaf } from '@/features/billing/PricingPage';
import { errorMessage, request } from '@/lib/api';

/*
 * DEVELOPMENT-ONLY sandbox for the payment lifecycle (Phase 3). The routes are added to the
 * router only when import.meta.env.DEV, so production builds contain none of this, and nothing
 * links here. The API side exists only with PAYMENTS_MODE=sandbox and the TEST PROVIDER.
 */

type Status = { mode: string; provider: string; testItem: { product: string; option: string; priceXaf: number } | null };
const FINAL = new Set(['FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'NEEDS_REVIEW', 'REFUNDED']);

export function TestPaymentsBanner() {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/15 px-4 py-3 text-small text-warning"
    >
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Test payments.</strong> TEST PROVIDER only: no real money moves, and these orders never count as revenue.
      </p>
    </div>
  );
}

function OrderCard({ order }: { order: OrderView }) {
  return (
    <Panel className="p-4" aria-label="Order status">
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant={order.status === 'FULFILLED' ? 'signal' : 'gray'}>{order.status.replace('_', ' ').toLowerCase()}</Pill>
        <Pill variant="gold">{order.mode.toLowerCase()}</Pill>
      </div>
      <p className="mt-3 text-body text-text-1">{order.statusMessage}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small text-text-2">
        <dt>Item</dt>
        <dd>
          {order.product}, {order.option}
        </dd>
        <dt>Amount</dt>
        <dd>{formatXaf(order.amountXaf)}</dd>
        <dt>Reference</dt>
        <dd className="break-all">{order.reference}</dd>
      </dl>
    </Panel>
  );
}

/** /dev/payments — start a sandbox order for the test-only item. */
export function SandboxPaymentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['dev', 'payments'], queryFn: () => request<Status>('/dev/payments/status', null) });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Development"
        title="Payment sandbox"
        description="Start → pay, fail or cancel on the fake checkout → return page."
      />
      <TestPaymentsBanner />
      {status.isPending ? (
        <PageLoading />
      ) : status.isError ? (
        <LoadFailed
          message={`${errorMessage(status.error)} Is PAYMENTS_MODE=sandbox set for the API?`}
          onRetry={() => void status.refetch()}
        />
      ) : (
        <Panel className="p-4">
          {status.data.testItem ? (
            <>
              <p className="text-small text-text-2">
                Test item ({status.data.testItem.option}): {formatXaf(status.data.testItem.priceXaf)}
              </p>
              <Button
                className="mt-3"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const res = await request('/checkout', checkoutResultSchema, {
                      method: 'POST',
                      body: { product: status.data.testItem!.product, option: status.data.testItem!.option },
                      idempotencyKey: crypto.randomUUID(),
                    });
                    if (res.order.checkoutUrl) window.location.assign(res.order.checkoutUrl);
                    else void navigate(`/checkout/return?reference=${encodeURIComponent(res.order.reference)}`);
                  })
                }
              >
                Start test payment
              </Button>
            </>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await request('/dev/payments/test-item', null, { method: 'POST' });
                  await qc.invalidateQueries({ queryKey: ['dev', 'payments'] });
                })
              }
            >
              Create the test-only item
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-3 text-small text-danger">
              {error}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

/** /dev/payments/checkout — plays the provider's hosted page. */
export function FakeCheckoutPage() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const settle = async (outcome: 'paid' | 'failed' | 'cancelled') => {
    setError(null);
    try {
      await request(`/dev/payments/orders/${encodeURIComponent(reference)}/settle`, null, { method: 'POST', body: { outcome } });
      void navigate(`/checkout/return?reference=${encodeURIComponent(reference)}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="mx-auto max-w-content">
      <PageHeader eyebrow="TEST PROVIDER" title="Fake checkout" description="Stands in for the provider's hosted payment page." />
      <TestPaymentsBanner />
      <Panel className="p-4">
        <p className="text-small break-all text-text-2">Reference {reference}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void settle('paid')}>Pay (test)</Button>
          <Button variant="outline" onClick={() => void settle('failed')}>
            Fail
          </Button>
          <Button variant="outline" onClick={() => void settle('cancelled')}>
            Cancel at provider
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-small text-danger">
            {error}
          </p>
        )}
      </Panel>
    </div>
  );
}

/**
 * /checkout/return — shows ONLY our own order status (never the provider's redirect parameters),
 * refreshing until it is final. Development builds only in Phase 3.
 */
export function CheckoutReturnPage() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['order', reference],
    queryFn: () => request(`/checkout/orders/${encodeURIComponent(reference)}`, orderViewSchema),
    refetchInterval: (q) => (q.state.data && FINAL.has(q.state.data.status) ? false : 1500),
  });
  return (
    <div className="mx-auto max-w-content">
      <PageHeader eyebrow="Payment" title="Your order" />
      {order.data?.mode === 'SANDBOX' && <TestPaymentsBanner />}
      {order.isPending ? (
        <PageLoading />
      ) : order.isError ? (
        <LoadFailed message={errorMessage(order.error)} onRetry={() => void order.refetch()} />
      ) : (
        <>
          <OrderCard order={order.data} />
          <div className="mt-4 flex flex-wrap gap-2">
            {order.data.status === 'PENDING' && (
              <Button
                variant="outline"
                onClick={async () => {
                  await request(`/checkout/orders/${encodeURIComponent(reference)}/cancel`, orderViewSchema, { method: 'POST' });
                  await qc.invalidateQueries({ queryKey: ['order', reference] });
                }}
              >
                Cancel order
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link to="/dev/payments">Back to sandbox</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
