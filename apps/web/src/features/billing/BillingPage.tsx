import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_NAMES, type BillingOverview } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { FormError } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { EmptyState, PageHeader, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { billingApi, billingKeys } from '@/lib/billing';
import { flatten } from '@/lib/social-queries';
import { formatDate, formatXaf, OrderStatusPill } from './ui';

/** /settings/billing — your plan, its dates, renew / change / cancel, and your transactions. */
export function BillingPage() {
  const overview = useQuery({ queryKey: billingKeys.overview, queryFn: billingApi.overview });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Settings" title="Billing" description="Your plan, its dates and your payments." />
      {overview.isPending ? (
        <PageLoading />
      ) : overview.isError ? (
        <LoadFailed message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
      ) : (
        <div className="space-y-4">
          <PlanPanel o={overview.data} />
          <Promotions />
          <Transactions />
        </div>
      )}
    </div>
  );
}

function PlanPanel({ o }: { o: BillingOverview }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = o.periods.find((p) => p.state === 'current' && p.plan === o.plan);
  const queued = o.periods.filter((p) => p.state === 'queued');
  const renewTo = o.plan === 'FREE' ? null : `/billing/checkout?product=${o.plan}&option=MONTHLY`;

  return (
    <Panel className="p-5" aria-labelledby="your-plan">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="your-plan" className="text-h3">
          {o.planName}
        </h2>
        {o.plan !== 'FREE' && (o.cancelled ? <Pill variant="gold">Cancelled</Pill> : <Pill>Active</Pill>)}
      </div>
      {o.plan === 'FREE' ? (
        <p className="mt-1 text-small text-text-2">Everything you need to build your presence. Paid plans add room and insight.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
          {current && (
            <>
              <dt className="text-text-2">Started</dt>
              <dd>{formatDate(current.periodStart)}</dd>
            </>
          )}
          <dt className="text-text-2">{o.cancelled ? 'Ends' : 'Paid until'}</dt>
          <dd>{o.planUntil ? formatDate(o.planUntil) : '—'}</dd>
        </dl>
      )}
      {queued.length > 0 && (
        <ul className="mt-3 space-y-1 text-small text-text-2">
          {queued.map((q) => (
            <li key={q.id}>
              Next: {PLAN_NAMES[q.plan]} from {formatDate(q.periodStart)} to {formatDate(q.periodEnd)}
            </li>
          ))}
        </ul>
      )}
      {o.plan !== 'FREE' && (
        <p className="mt-3 text-caption text-text-3">
          Plans don’t renew automatically.{' '}
          {o.cancelled ? 'You won’t get renewal reminders.' : 'We’ll remind you in the app 3 days before the end.'}
        </p>
      )}
      <FormError message={error} />
      <div className="mt-4 flex flex-wrap gap-2">
        {renewTo && (
          <Button asChild>
            <Link to={renewTo}>Renew</Link>
          </Button>
        )}
        <Button asChild variant={o.plan === 'FREE' ? 'primary' : 'outline'}>
          <Link to="/pricing">{o.plan === 'FREE' ? 'See plans' : 'Change plan'}</Link>
        </Button>
        {o.plan !== 'FREE' && !o.cancelled && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Cancel plan
          </Button>
        )}
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Cancel your plan?">
        <p className="text-small text-text-2">
          You keep {o.planName} until {o.planUntil ? formatDate(o.planUntil) : 'the end of the period'}. After that you’re on Free: your
          work and links stay, and paid extras are hidden. Cancelling doesn’t refund the current period.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Keep plan
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                qc.setQueryData(billingKeys.overview, await billingApi.cancelSubscription());
                await qc.invalidateQueries({ queryKey: billingKeys.unread });
                setConfirm(false);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Cancelling…' : 'Cancel plan'}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

function Promotions() {
  const q = useQuery({ queryKey: ['billing', 'promotions'], queryFn: billingApi.promotions });
  if (q.isPending || q.isError || q.data.items.length === 0) return null;
  return (
    <section aria-labelledby="promotions">
      <h2 id="promotions" className="mb-2 text-h3">
        Your promotions
      </h2>
      <ul className="space-y-2">
        {q.data.items.map((p) => (
          <li key={p.id}>
            <Panel className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {p.product === 'POST_BOOST' ? 'Post Boost' : 'Profile Spotlight'}: {p.targetLabel}
                </p>
                <Pill variant={p.state === 'running' ? 'signal' : 'gray'}>
                  {{ running: 'Running', queued: 'Starts later', ended: 'Ended' }[p.state]}
                </Pill>
              </div>
              <p className="mt-1 text-caption text-text-2">
                {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
                {p.endedReason && <> · Ended early: {p.endedReason}</>}
              </p>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transactions() {
  const q = useInfiniteQuery({
    queryKey: billingKeys.orders,
    queryFn: ({ pageParam }) => billingApi.orders(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(q.data);
  return (
    <section aria-labelledby="transactions">
      <h2 id="transactions" className="mb-2 text-h3">
        Transactions
      </h2>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No payments yet">Your plan purchases and promotions will appear here.</EmptyState>
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <ul className="space-y-2">
            {rows.map((o) => (
              <li key={o.reference}>
                <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {o.product}, {o.option}
                      {o.mode === 'SANDBOX' && <span className="ml-2 text-caption text-warning">Test</span>}
                    </p>
                    <p className="text-caption text-text-2">
                      {formatDate(o.createdAt)} · {formatXaf(o.amountXaf)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OrderStatusPill status={o.status} />
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/billing/orders/${encodeURIComponent(o.reference)}`}
                        aria-label={`Receipt for ${o.product}, ${formatDate(o.createdAt)}`}
                      >
                        Receipt
                      </Link>
                    </Button>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        </InfiniteList>
      )}
    </section>
  );
}
