import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BILLING_PRODUCTS, CATALOGUE_OPTIONS, type CatalogueOption } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatDate, formatXaf, TestPaymentsBanner } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { billingApi, useCatalogue } from '@/lib/billing';

const WHAT = {
  POST_BOOST: 'Your post appears in the labelled “Promoted” place at the top of the feed and on Discover, separate from regular posts.',
  PROFILE_SPOTLIGHT: 'Your profile appears in the labelled Spotlight row on Discover.',
} as const;

/**
 * /promote?product=POST_BOOST&targetId=… or ?product=PROFILE_SPOTLIGHT — choose a duration, see the
 * price and exactly when it runs (server preview), then pay. Promotion starts only after the
 * payment is verified with the provider.
 */
export function PromotePage() {
  const [params] = useSearchParams();
  const product =
    params.get('product') === 'PROFILE_SPOTLIGHT' ? 'PROFILE_SPOTLIGHT' : params.get('product') === 'POST_BOOST' ? 'POST_BOOST' : null;
  const targetId = params.get('targetId') ?? undefined;
  const catalogue = useCatalogue();
  const options = (catalogue.data?.items ?? []).filter((i) => i.product === product && i.purchasable && i.priceXaf != null);
  const [chosen, setChosen] = useState<CatalogueOption | null>(null);
  const option = chosen ?? options[0]?.option ?? null;
  const item = options.find((o) => o.option === option);
  const preview = useQuery({
    queryKey: ['promotion-preview', product, option, targetId],
    queryFn: () => billingApi.promotionPreview(product!, option!, targetId),
    enabled: Boolean(product && option),
    retry: false,
  });
  const key = useMemo(() => crypto.randomUUID(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!product) return <EmptyState title="Nothing to promote">Start from one of your posts or your profile.</EmptyState>;
  if (catalogue.isPending) return <PageLoading />;
  if (catalogue.isError) return <LoadFailed message={errorMessage(catalogue.error)} onRetry={() => void catalogue.refetch()} />;
  if (options.length === 0) return <EmptyState title="Not available yet">{BILLING_PRODUCTS[product]} can’t be bought yet.</EmptyState>;

  async function pay() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const res = await billingApi.checkout(
        { product: product!, option: item.option, ...(targetId && { targetId }) },
        `${key}:${item.option}`,
      );
      window.location.assign(res.order.checkoutUrl ?? `/checkout/return?reference=${encodeURIComponent(res.order.reference)}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Promote" title={BILLING_PRODUCTS[product]} description={WHAT[product]} />
      {catalogue.data.paymentsMode === 'sandbox' && <TestPaymentsBanner />}
      <Panel className="p-5">
        <p className="text-small font-semibold text-text-1">How long?</p>
        <div role="group" aria-label="Duration" className="mt-2 flex flex-wrap gap-2">
          {options.map((o) => (
            <ToggleChip key={o.option} selected={o.option === option} onClick={() => setChosen(o.option)}>
              {CATALOGUE_OPTIONS[o.option].label} · {formatXaf(o.priceXaf!)}
            </ToggleChip>
          ))}
        </div>
        {preview.isError ? (
          <FormError message={errorMessage(preview.error)} />
        ) : preview.data ? (
          <p className="mt-4 rounded-s border border-hairline-strong bg-surface-overlay p-3 text-small text-text-1">
            {preview.data.extendsCurrent ? 'Added after your current promotion: ' : 'Runs '}
            {formatDate(preview.data.startsAt)} to {formatDate(preview.data.endsAt)}.
          </p>
        ) : null}
        <p className="mt-3 text-caption text-text-3">
          Clearly labelled as paid. No guaranteed plays, followers or results. It starts only after we confirm your payment with the
          provider, and moderators can end promotions that break the rules.
        </p>
        <FormError message={error} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void pay()} disabled={busy || !item || preview.isError}>
            {busy ? 'Starting…' : item ? `Continue to payment · ${formatXaf(item.priceXaf!)}` : 'Choose a duration'}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/pricing">See all prices</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
