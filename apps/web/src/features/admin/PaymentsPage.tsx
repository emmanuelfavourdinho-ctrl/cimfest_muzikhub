import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@muzikhub/shared';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatXaf, OrderStatusPill } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { flatten } from '@/lib/social-queries';
import { adminApi } from './admin-api';
import { AdminHeader, Ago, DataTable, EmptyRow, FilterTabs, Section, Stat, Tag } from './ui';

type Filter = 'ALL' | OrderStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'NEEDS_REVIEW', label: 'Needs review' },
  { value: 'FULFILMENT_PENDING', label: 'Activating' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'FULFILLED', label: 'Paid' },
  { value: 'REFUNDED', label: 'Refunded' },
];

/** /admin/payments — verified backend data only. Sandbox orders are never revenue. */
export function PaymentsPage() {
  const [status, setStatus] = useState<Filter>('NEEDS_REVIEW');
  const [mode, setMode] = useState<'' | 'SANDBOX' | 'LIVE'>('');
  const summary = useQuery({ queryKey: ['admin', 'payments', 'summary'], queryFn: adminApi.paymentsSummary });
  const q = useInfiniteQuery({
    queryKey: ['admin', 'payments', status, mode],
    queryFn: ({ pageParam }) =>
      adminApi.paymentOrders({ cursor: pageParam, status: status === 'ALL' ? undefined : status, mode: mode || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(q.data);
  const count = (s: OrderStatus, m?: string) =>
    (summary.data?.counts ?? []).filter((c) => c.status === s && (!m || c.mode === m)).reduce((t, c) => t + c.count, 0);

  return (
    <div>
      <AdminHeader
        title="Payments"
        description="Orders as verified with the provider. Sandbox (test) orders are labelled and never count as revenue. Live payments are not enabled."
      />
      {summary.data && (
        <Section title="Summary">
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Stat
              label="Live revenue"
              value={formatXaf(summary.data.liveRevenueXaf)}
              hint={`${summary.data.liveOrders} live paid orders`}
            />
            <Stat label="Needs review" value={count('NEEDS_REVIEW')} />
            <Stat label="Activating" value={count('FULFILMENT_PENDING')} hint="Paid, benefit not granted yet" />
            <Stat
              label="Sandbox orders"
              value={summary.data.counts.filter((c) => c.mode === 'SANDBOX').reduce((t, c) => t + c.count, 0)}
              hint="Test payments, excluded"
            />
          </dl>
        </Section>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <FilterTabs label="Filter by status" value={status} options={FILTERS} onChange={setStatus} />
        <select
          aria-label="Filter by mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="h-11 rounded-s border border-control-border bg-surface-raised px-3 text-sm sm:w-44"
        >
          <option value="">Sandbox and live</option>
          <option value="SANDBOX">Sandbox only</option>
          <option value="LIVE">Live only</option>
        </select>
      </div>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <DataTable label="Orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Member</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={5}>No orders match.</EmptyRow>
              ) : (
                rows.map((o) => (
                  <tr key={o.reference}>
                    <td>
                      <Link to={`/admin/payments/${encodeURIComponent(o.reference)}`} className="font-medium hover:text-signal">
                        {o.product}, {o.option}
                      </Link>
                      <span className="ml-2">{o.mode === 'SANDBOX' ? <Tag color="gold">Sandbox</Tag> : <Tag color="green">Live</Tag>}</span>
                      <span className="block font-mono text-xs text-text-3">{o.reference}</span>
                    </td>
                    <td>{o.user.name}</td>
                    <td className="tabular-nums">{formatXaf(o.amountXaf)}</td>
                    <td>
                      <OrderStatusPill status={o.status} />
                      {o.statusReason && <span className="block text-xs text-text-3">{o.statusReason.replace('_', ' ')}</span>}
                    </td>
                    <td>
                      <Ago iso={o.createdAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </InfiniteList>
      )}
    </div>
  );
}
