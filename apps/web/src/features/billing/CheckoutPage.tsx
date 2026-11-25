import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BILLING_PRODUCTS, CATALOGUE_OPTIONS, type BillingProduct, type CatalogueOption } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { billingApi, useCatalogue } from '@/lib/billing';
import { formatDate, formatXaf, TestPaymentsBanner } from './ui';

const PLANS = ['CREATOR_PLUS', 'PRO'] as const;

/**
 * /billing/checkout?product=&option= — review before paying: item, price, period and exactly
 * what the purchase will do (computed by the server). Then hand over to the payment provider.
 */
export function CheckoutPage() {
  const [params] = useSearchParams();
  const product = params.get('product') as BillingProduct | null;
  const option = params.get('option') as CatalogueOption | null;
  const catalogue = useCatalogue();
  const isPlan = (PLANS as readonly string[]).includes(product ?? '');
  const preview = useQuery({
    queryKey: ['billing', 'preview', product, option],
    queryFn: () => billingApi.preview(product!, option!),
    enabled: isPlan && Boolean(option),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per visit: a double click or retry returns the same order (server-side idempotency).
  const key = useMemo(() => crypto.randomUUID(), []);

  if (catalogue.isPending || (isPlan && preview.isPending)) return <PageLoading />;
  if (catalogue.isError) return <LoadFailed message={errorMessage(catalogue.error)} onRetry={() => void catalogue.refetch()} />;
  const item = catalogue.data.items.find((i) => i.product === product && i.option === option);
  if (!isPlan || !item)
    return (
      <EmptyState title="Nothing to check out">
        Choose a plan on the{' '}
        <Link to="/pricing" className="text-signal underline">
          pricing page
        </Link>
        .
      </EmptyState>
    );
  if (!item.purchasable || item.priceXaf == null)
    return <EmptyState title="Not available yet">{BILLING_PRODUCTS[item.product]} can’t be bought yet.</EmptyState>;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await billingApi.checkout({ product: item!.product, option: item!.option }, key);
      if (res.order.checkoutUrl) window.location.assign(res.order.checkoutUrl);
      else window.location.assign(`/checkout/return?reference=${encodeURIComponent(res.order.reference)}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Checkout" title="Review your plan" />
      {catalogue.data.paymentsMode === 'sandbox' && <TestPaymentsBanner />}
      <Panel className="p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
          <dt className="text-text-2">Plan</dt>
          <dd className="font-semibold">{BILLING_PRODUCTS[item.product]}</dd>
          <dt className="text-text-2">Billing</dt>
          <dd>
            {CATALOGUE_OPTIONS[item.option].label} ({item.durationDays} days)
          </dd>
          <dt className="text-text-2">Price</dt>
          <dd className="font-semibold">{formatXaf(item.priceXaf)}</dd>
          {preview.data && (
            <>
              <dt className="text-text-2">Runs</dt>
              <dd>
                {formatDate(preview.data.startsAt)} to {formatDate(preview.data.endsAt)}
              </dd>
            </>
          )}
        </dl>
        {preview.isError ? (
          <FormError message={errorMessage(preview.error)} />
        ) : (
          preview.data && (
            <p className="mt-4 rounded-s border border-hairline-strong bg-surface-overlay p-3 text-small text-text-1">
              {preview.data.note}
            </p>
          )
        )}
        <p className="mt-3 text-caption text-text-3">
          You’ll pay on the payment provider’s page. Your plan starts only after we confirm the payment with the provider, not when the page
          says it worked. It doesn’t renew automatically.
        </p>
        <FormError message={error} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void pay()} disabled={busy}>
            {busy ? 'Starting…' : `Continue to payment · ${formatXaf(item.priceXaf)}`}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/pricing">Back</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
