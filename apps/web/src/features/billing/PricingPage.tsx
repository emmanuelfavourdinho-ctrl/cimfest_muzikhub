import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Minus } from 'lucide-react';
import {
  BILLING_PRODUCTS,
  CATALOGUE_OPTIONS,
  MB,
  type CatalogueItem,
  type PlanKey,
  type PlanLimits,
  type PublicCatalogue,
} from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, PageLoading, Panel, Pill, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { useCatalogue, useEntitlements } from '@/lib/billing';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { formatXaf, TestPaymentsBanner } from './ui';

export { formatXaf } from './ui';

/** What everyone gets, whatever the plan (CLAUDE.md §2.1: basic participation is free). */
const ALWAYS_FREE = [
  'A professional profile, portfolio and public work pages',
  'Posting, comments, reactions and the feed',
  'Discovery, following and connections',
  'Opportunities: browse and apply',
];

type Period = 'MONTHLY' | 'ANNUAL';
const PAID: Exclude<PlanKey, 'FREE'>[] = ['CREATOR_PLUS', 'PRO'];

/**
 * /pricing — everything shown comes from GET /catalogue (prices, availability, plan limits and
 * benefits). A price appears only for what can actually be bought in the current payment mode.
 */
export function PricingPage() {
  const catalogue = useCatalogue();
  const [period, setPeriod] = useState<Period>('MONTHLY');

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Pricing"
        title="Free to build your presence"
        description="Profiles, portfolios, discovery and networking are free for everyone. Paid plans add room and insight for working professionals."
      />
      {catalogue.isPending ? (
        <PageLoading />
      ) : catalogue.isError ? (
        <LoadFailed message={errorMessage(catalogue.error)} onRetry={() => void catalogue.refetch()} />
      ) : catalogue.data.plans.length === 0 ? (
        <EmptyState title="No plans to show">The catalogue is empty right now. Please check back soon.</EmptyState>
      ) : (
        <Pricing data={catalogue.data} period={period} setPeriod={setPeriod} />
      )}
    </div>
  );
}

function Pricing({ data, period, setPeriod }: { data: PublicCatalogue; period: Period; setPeriod: (p: Period) => void }) {
  const item = (product: string, option: string) => data.items.find((i) => i.product === product && i.option === option);
  const anyPurchasable = data.items.some((i) => i.purchasable);
  return (
    <>
      {data.paymentsMode === 'sandbox' && anyPurchasable && <TestPaymentsBanner />}
      <div role="group" aria-label="Billing period" className="mb-4 flex gap-2">
        <ToggleChip selected={period === 'MONTHLY'} onClick={() => setPeriod('MONTHLY')}>
          Monthly
        </ToggleChip>
        <ToggleChip selected={period === 'ANNUAL'} onClick={() => setPeriod('ANNUAL')}>
          Annual
        </ToggleChip>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PlanCard plan={data.plans[0]!} period={period} />
        {PAID.map((key) => (
          <PlanCard
            key={key}
            plan={data.plans.find((p) => p.key === key)!}
            period={period}
            monthly={item(key, 'MONTHLY')}
            annual={item(key, 'ANNUAL')}
          />
        ))}
      </div>

      <Comparison data={data} />
      <HowItWorks />
      <Promotions data={data} />
      <p className="mt-6 text-caption text-text-3">
        Prices are in FCFA (XAF). The price shown is the price you pay: MuzikHub covers the payment provider’s fees.
      </p>
    </>
  );
}

function PlanCard({
  plan,
  period,
  monthly,
  annual,
}: {
  plan: PublicCatalogue['plans'][number];
  period: Period;
  monthly?: CatalogueItem;
  annual?: CatalogueItem;
}) {
  const { data: me } = useMe();
  const ent = useEntitlements();
  const current = me && ent.data?.plan === plan.key;
  const chosen = period === 'MONTHLY' ? monthly : annual;
  const isFree = plan.key === 'FREE';
  const savings = monthly?.priceXaf != null && annual?.priceXaf != null ? monthly.priceXaf * 12 - annual.priceXaf : null;
  const id = `plan-${plan.key.toLowerCase()}`;

  return (
    <Panel className={cn('flex flex-col p-5', plan.key === 'CREATOR_PLUS' && 'border-control-border')} aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-h3">
          {plan.name}
        </h2>
        {current ? <Pill>Your plan</Pill> : !isFree && !chosen?.purchasable && <Pill variant="gray">Coming soon</Pill>}
      </div>

      <div className="mt-2 min-h-16">
        {isFree ? (
          <p className="text-h2">{formatXaf(0)}</p>
        ) : chosen?.purchasable && chosen.priceXaf != null ? (
          <>
            <p className="text-h2">
              {formatXaf(chosen.priceXaf)}
              <span className="text-small font-normal text-text-2"> / {period === 'MONTHLY' ? 'month' : 'year'}</span>
            </p>
            {period === 'ANNUAL' && savings != null && savings > 0 && (
              <p className="text-caption text-signal">Save {formatXaf(savings)} compared with 12 monthly payments</p>
            )}
          </>
        ) : (
          <p className="text-small text-text-2">Not available to buy yet. The price will appear here when it is.</p>
        )}
      </div>

      <ul className="mt-3 flex-1 space-y-2 text-small text-text-2">
        {(isFree
          ? [...ALWAYS_FREE, ...plan.benefits]
          : [plan.key === 'PRO' ? 'Everything in Creator Plus' : 'Everything in Free', ...plan.benefits]
        ).map((b) => (
          <li key={b} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
            {b}
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <PlanAction plan={plan.key} item={chosen} current={Boolean(current)} />
      </div>
    </Panel>
  );
}

function PlanAction({ plan, item, current }: { plan: PlanKey; item?: CatalogueItem; current: boolean }) {
  const { data: me } = useMe();
  if (plan === 'FREE') {
    return me ? (
      <Button variant="outline" className="w-full" disabled>
        Included for everyone
      </Button>
    ) : (
      <Button asChild variant="outline" className="w-full">
        <Link to="/register">Join free</Link>
      </Button>
    );
  }
  if (!item?.purchasable) {
    return (
      <Button className="w-full" disabled>
        Coming soon
      </Button>
    );
  }
  const to = `/billing/checkout?product=${plan}&option=${item.option}`;
  if (!me) {
    return (
      <Button asChild className="w-full">
        <Link to={`/login?next=${encodeURIComponent(to)}`}>Sign in to choose</Link>
      </Button>
    );
  }
  return (
    <Button asChild className="w-full">
      <Link to={to}>{current ? 'Renew' : `Choose ${plan === 'PRO' ? 'Pro' : 'Creator Plus'}`}</Link>
    </Button>
  );
}

const mb = (b: number) => `${Math.round(b / MB)} MB`;
const ROWS: { label: string; value: (l: PlanLimits) => string | boolean }[] = [
  { label: 'Image uploads', value: (l) => `up to ${mb(l.imageBytes)}` },
  { label: 'Audio uploads', value: (l) => `up to ${mb(l.audioBytes)}` },
  { label: 'Video uploads', value: (l) => `up to ${mb(l.videoBytes)}` },
  { label: 'Profile links', value: (l) => `up to ${l.profileLinks}` },
  { label: 'Profile accent colour', value: (l) => l.profileAccent },
  { label: 'Analytics history', value: (l) => (l.analyticsDays ? `${l.analyticsDays} days` : false) },
  { label: 'Per-item analytics', value: (l) => l.itemAnalytics },
];

function Comparison({ data }: { data: PublicCatalogue }) {
  return (
    <section aria-labelledby="compare" className="mt-8">
      <h2 id="compare" className="text-h3">
        Compare plans
      </h2>
      <div
        role="region"
        aria-label="Plan comparison"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-panel border border-hairline-strong bg-surface-raised"
      >
        <table className="w-full min-w-120 text-left text-small [&_td]:border-t [&_td]:border-hairline-strong [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
          <thead>
            <tr>
              <th scope="col" className="text-text-2">
                Limit
              </th>
              {data.plans.map((p) => (
                <th key={p.key} scope="col">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="font-normal text-text-2">
                  {row.label}
                </th>
                {data.plans.map((p) => {
                  const v = row.value(p.limits);
                  return (
                    <td key={p.key}>
                      {v === true ? (
                        <>
                          <Check aria-hidden className="size-4 text-signal" />
                          <span className="sr-only">Included</span>
                        </>
                      ) : v === false ? (
                        <>
                          <Minus aria-hidden className="size-4 text-text-3" />
                          <span className="sr-only">Not included</span>
                        </>
                      ) : (
                        v
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-text-3">
        Image and video limits are the same on every plan: they’re already at the maximum our media service allows.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how" className="mt-8">
      <h2 id="how" className="text-h3">
        How plans work
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          [
            'No automatic renewal',
            'You pay for a month (30 days) or a year (365 days) at a time. Nothing is charged again unless you renew.',
          ],
          [
            'Upgrading',
            'Starts straight away. There is no proration: days left on your current plan run alongside the new one and aren’t refunded.',
          ],
          ['Downgrading', 'Starts when your current plan ends, so you keep what you paid for until then.'],
          [
            'Cancelling',
            'You keep your plan until its end date and stop getting renewal reminders. Your work and links are never deleted.',
          ],
        ].map(([t, d]) => (
          <div key={t} className="rounded-panel border border-hairline-strong bg-surface-raised p-4 shadow-e1">
            <dt className="font-semibold text-text-1">{t}</dt>
            <dd className="mt-1 text-small text-text-2">{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Promotions({ data }: { data: PublicCatalogue }) {
  const products = [
    ['POST_BOOST', 'A labelled “Promoted” place for one of your posts at the top of the feed and Discover, separate from regular posts.'],
    ['PROFILE_SPOTLIGHT', 'Your profile in the labelled Spotlight row on Discover.'],
  ] as const;
  return (
    <section aria-labelledby="promote" className="mt-8">
      <h2 id="promote" className="text-h3">
        Promotions
      </h2>
      <p className="mt-1 text-small text-text-2">Clearly labelled, time-limited visibility. No guaranteed plays, followers or results.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {products.map(([product, description]) => {
          const items = data.items.filter((i) => i.product === product);
          const buyable = items.filter((i) => i.purchasable && i.priceXaf != null);
          return (
            <Panel key={product} className="p-4" aria-label={BILLING_PRODUCTS[product]}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{BILLING_PRODUCTS[product]}</h3>
                {buyable.length === 0 && <Pill variant="gray">Coming soon</Pill>}
              </div>
              <p className="mt-1 text-small text-text-2">{description}</p>
              {buyable.length > 0 && (
                <ul className="mt-2 space-y-1 text-small">
                  {buyable.map((i) => (
                    <li key={i.option} className="flex justify-between gap-3">
                      <span className="text-text-2">{CATALOGUE_OPTIONS[i.option].label}</span>
                      <span className="font-semibold">{formatXaf(i.priceXaf!)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {buyable.length > 0 && (
                <p className="mt-2 text-caption text-text-3">
                  {product === 'POST_BOOST' ? 'Buy from the menu on one of your posts.' : 'Buy from your own profile.'}
                </p>
              )}
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
