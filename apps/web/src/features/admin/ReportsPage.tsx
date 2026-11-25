import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { REPORT_REASONS } from '@muzikhub/shared';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { flatten } from '@/lib/social-queries';
import { adminApi } from './admin-api';
import { AdminHeader, Ago, DataTable, EmptyRow, FilterTabs, ReportStatusTag, Tag } from './ui';

const VIEWS = {
  open: { label: 'Open', query: { open: 'true' } },
  mine: { label: 'Assigned to me', query: { open: 'true', assigned: 'me' } },
  unassigned: { label: 'Unassigned', query: { open: 'true', assigned: 'unassigned' } },
  escalated: { label: 'Escalated', query: { open: 'true', escalated: 'true' } },
  resolved: { label: 'Resolved', query: { status: 'RESOLVED' } },
  dismissed: { label: 'Dismissed', query: { status: 'DISMISSED' } },
} as const;
type View = keyof typeof VIEWS;

export const TARGET_LABEL: Record<string, string> = { POST: 'Post', COMMENT: 'Comment', PORTFOLIO_ITEM: 'Portfolio', PROFILE: 'Profile' };

/** Central reports queue. Open work is oldest-first (escalated on top). */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const view = ((params.get('view') as View) in VIEWS ? params.get('view') : 'open') as View;
  const query = useInfiniteQuery({
    queryKey: ['admin', 'reports', view],
    queryFn: ({ pageParam }) => adminApi.reports({ ...VIEWS[view].query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(query.data);

  return (
    <div>
      <AdminHeader
        title="Reports"
        description="Reports from members. Open the report to review the content, take action and record your decision."
      />
      <FilterTabs
        label="Report views"
        value={view}
        onChange={(v) => setParams(v === 'open' ? {} : { view: v }, { replace: true })}
        options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: VIEWS[v].label }))}
      />
      {query.isPending ? (
        <PageLoading />
      ) : query.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <InfiniteList
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
          isError={query.isError}
        >
          <DataTable label="Reports">
            <thead>
              <tr>
                <th>Reported</th>
                <th>Reason</th>
                <th>Content</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={6}>{view === 'open' ? 'No open reports. Nice.' : 'Nothing here.'}</EmptyRow>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-text-2">
                      <Ago iso={r.createdAt} />
                    </td>
                    <td>
                      <Link to={`/admin/reports/${r.id}`} className="font-semibold text-foreground hover:text-signal">
                        {REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? r.reason}
                      </Link>
                      {(r.openReportsOnTarget ?? 0) > 1 && (
                        <Tag color="gold" className="ml-1.5">
                          {r.openReportsOnTarget} reports
                        </Tag>
                      )}
                    </td>
                    <td className="max-w-70">
                      <span className="text-xs text-text-2 uppercase">{TARGET_LABEL[r.targetType]}</span>
                      <p className="line-clamp-2">
                        {r.target.exists ? (r.target.text ?? r.target.title) : <span className="text-text-2 italic">no longer exists</span>}
                      </p>
                      {r.target.removed && <Tag color="red">Removed</Tag>}
                    </td>
                    <td>
                      {r.target.owner ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={r.target.owner.name} image={r.target.owner.image} className="size-6 text-xs" />
                          {r.target.owner.name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <ReportStatusTag status={r.status} escalated={r.escalated} />
                    </td>
                    <td className="text-text-2">{r.assignee?.name ?? '—'}</td>
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
