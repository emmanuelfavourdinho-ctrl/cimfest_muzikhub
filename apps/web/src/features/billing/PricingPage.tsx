import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import {
  BILLING_PRODUCT_KEYS,
  BILLING_PRODUCTS,
  CATALOGUE_OPTIONS,
  MB,
  publicCatalogueSchema,
  type CatalogueItem,
  type PlanLimits,
} from '@muzikhub/shared';
import { PageHeader, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage, request } from '@/lib/api';

export const formatXaf = (n: number) => `${new Intl.NumberFormat('fr-CM').format(n)} FCFA`;

/** What every member gets for free, read from the live catalogue (today's real limits). */
function freeFeatures(l: PlanLimits) {
  return [
    'A professional profile, portfolio and public work pages',
    'Posting, comments, reactions and the feed',
    'Discovery, following and connections',
    'Opportunities: browse and apply',
    `Uploads up to ${l.imageBytes / MB} MB per image, ${l.audioBytes / MB} MB per audio file and ${l.videoBytes / MB} MB per video`,
    `Up to ${l.profileLinks} links on your profile`,
  ];
}

/**
 * Public pricing (ADR 0004). Shows a price ONLY for items the server says can be bought
 * right now; everything else is "Coming soon" with no price and no benefit promises.
 */
export function PricingPage() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['catalogue'],
    queryFn: () => request('/catalogue', publicCatalogueSchema),
  });

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Pricing"
        title="MuzikHub is free to use"
        description="Building your presence, sharing your work and connecting with people will always be free. Optional paid extras are on the way."
      />
      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5" aria-labelledby="plan-free">
            <div className="flex items-center justify-between gap-3">
              <h2 id="plan-free" className="text-h3">
                Free
              </h2>
              <Pill>Available now</Pill>
            </div>
            <p className="mt-1 text-h2">{formatXaf(0)}</p>
            <ul className="mt-4 space-y-2 text-small text-text-2">
              {freeFeatures(data.free.limits).map((f) => (
                <li key={f} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
                  {f}
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-3">
            {BILLING_PRODUCT_KEYS.map((product) => {
              const items = data.items.filter((i) => i.product === product);
              if (items.length === 0) return null;
              return <ProductCard key={product} name={BILLING_PRODUCTS[product]} items={items} />;
            })}
          </div>
        </div>
      )}
      <p className="mt-6 text-caption text-text-3">Prices are in FCFA (XAF). The price you see at checkout is the price you pay.</p>
    </div>
  );
}

function ProductCard({ name, items }: { name: string; items: CatalogueItem[] }) {
  const onSale = items.filter((i) => i.onSale && i.priceXaf !== null);
  const id = `product-${name.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <Panel className="p-4" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-h3">
          {name}
        </h2>
        {onSale.length === 0 && <Pill variant="gray">Coming soon</Pill>}
      </div>
      {onSale.length === 0 ? (
        <p className="mt-1 text-small text-text-2">Not available yet. Details and prices will appear here when you can buy it.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-small">
          {onSale.map((i) => (
            <li key={i.option} className="flex justify-between gap-3">
              <span className="text-text-2">{CATALOGUE_OPTIONS[i.option].label}</span>
              <span className="font-semibold">{formatXaf(i.priceXaf!)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
