import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatDateTime } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { adminApi, type AdminPromotion } from './admin-api';
import { AdminHeader, DataTable, EmptyRow, FilterTabs, ReasonDialog, Tag, useAdminAction } from './ui';

/** /admin/promotions — what is being promoted now; moderators can end a promotion with a reason. */
export function PromotionsAdminPage() {
  const [state, setState] = useState<'running' | 'all'>('running');
  const q = useQuery({ queryKey: ['admin', 'promotions', state], queryFn: () => adminApi.promotions(state) });
  const [ending, setEnding] = useState<AdminPromotion | null>(null);
  const act = useAdminAction();
  return (
    <div>
      <AdminHeader
        title="Promotions"
        description="Paid Post Boosts and Profile Spotlights. Ending one removes it from the Promoted and Spotlight places at once; the owner is told why."
      />
      <FilterTabs
        label="Which promotions"
        value={state}
        onChange={setState}
        options={[
          { value: 'running', label: 'Running now' },
          { value: 'all', label: 'All' },
        ]}
      />
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable label="Promotions">
          <thead>
            <tr>
              <th scope="col">Promotion</th>
              <th scope="col">Owner</th>
              <th scope="col">Runs</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.length === 0 ? (
              <EmptyRow cols={5}>No promotions.</EmptyRow>
            ) : (
              q.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.product === 'POST_BOOST' ? (
                      <Link to={`/p/${p.targetId}`} className="hover:text-signal">
                        Post Boost
                      </Link>
                    ) : (
                      'Profile Spotlight'
                    )}
                  </td>
                  <td>{p.user.username ? <Link to={`/u/${p.user.username}`}>{p.user.name}</Link> : p.user.name}</td>
                  <td className="text-text-2">
                    {formatDateTime(p.periodStart)} – {formatDateTime(p.periodEnd)}
                  </td>
                  <td>
                    {p.running ? <Tag color="green">Running</Tag> : <Tag>{p.status === 'ACTIVE' ? 'Not running' : 'Ended'}</Tag>}
                    {p.endedReason && <span className="block text-xs text-text-3">{p.endedReason}</span>}
                  </td>
                  <td className="text-right">
                    {p.running && (
                      <Button size="sm" variant="outline" onClick={() => setEnding(p)} aria-label={`End promotion by ${p.user.name}`}>
                        End
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      )}
      <ReasonDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title="End this promotion"
        description="It stops appearing immediately. A refund, if due, is a separate admin action on the order."
        confirmLabel="End promotion"
        destructive
        onConfirm={(reason) => act(() => adminApi.endPromotion(ending!.id, reason), 'Promotion ended')}
      />
    </div>
  );
}
