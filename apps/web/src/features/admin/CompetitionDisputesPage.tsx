import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatDateTime } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { adminApi, type AdminDispute } from './admin-api';
import { AdminHeader, DataTable, EmptyRow, FilterTabs, ReasonDialog, Tag, useAdminAction } from './ui';

type Filter = 'OPEN' | 'UPHELD' | 'REJECTED';

/** /admin/competitions — entrants' disputes about published results (decision D9: staff decide). */
export function CompetitionDisputesPage() {
  const [status, setStatus] = useState<Filter>('OPEN');
  const q = useQuery({ queryKey: ['admin', 'competition-disputes', status], queryFn: () => adminApi.competitionDisputes(status) });
  const [deciding, setDeciding] = useState<{ dispute: AdminDispute; outcome: 'UPHELD' | 'REJECTED' } | null>(null);
  const act = useAdminAction();
  return (
    <div>
      <AdminHeader
        title="Competition disputes"
        description="Entrants can dispute published results for 7 days. Your decision is recorded and both the entrant and the organiser are told. Deciding never changes published results by itself."
      />
      <FilterTabs
        label="Which disputes"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'OPEN', label: 'Open' },
          { value: 'UPHELD', label: 'Upheld' },
          { value: 'REJECTED', label: 'Rejected' },
        ]}
      />
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable label="Competition disputes">
          <thead>
            <tr>
              <th scope="col">Competition</th>
              <th scope="col">Entrant</th>
              <th scope="col">Dispute</th>
              <th scope="col">Opened</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.length === 0 ? (
              <EmptyRow cols={5}>No {status.toLowerCase()} disputes.</EmptyRow>
            ) : (
              q.data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/competitions/${d.competition.slug}`} className="hover:text-signal">
                      {d.competition.title}
                    </Link>
                  </td>
                  <td>{d.user.username ? <Link to={`/u/${d.user.username}`}>{d.user.name}</Link> : d.user.name}</td>
                  <td className="max-w-md">
                    <p className="whitespace-pre-line">{d.reason}</p>
                    {d.resolution && (
                      <p className="mt-1 text-xs text-text-2">
                        <Tag color={d.status === 'UPHELD' ? 'green' : undefined}>{d.status === 'UPHELD' ? 'Upheld' : 'Rejected'}</Tag>{' '}
                        {d.resolution}
                      </p>
                    )}
                  </td>
                  <td className="text-text-2">{formatDateTime(d.createdAt)}</td>
                  <td className="text-right">
                    {d.status === 'OPEN' && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeciding({ dispute: d, outcome: 'UPHELD' })}
                          aria-label={`Uphold dispute by ${d.user.name}`}
                        >
                          Uphold
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeciding({ dispute: d, outcome: 'REJECTED' })}
                          aria-label={`Reject dispute by ${d.user.name}`}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      )}
      <ReasonDialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding?.outcome === 'UPHELD' ? 'Uphold this dispute' : 'Reject this dispute'}
        description="Explain the decision (at least 10 characters). It's shown to the entrant and the organiser and kept in the audit log. If results need correcting, the organiser must do that openly."
        reasonLabel="Decision"
        confirmLabel={deciding?.outcome === 'UPHELD' ? 'Uphold' : 'Reject'}
        onConfirm={(resolution) =>
          act(() => adminApi.resolveDispute(deciding!.dispute.id, deciding!.outcome, resolution), 'Decision recorded')
        }
      />
    </div>
  );
}
