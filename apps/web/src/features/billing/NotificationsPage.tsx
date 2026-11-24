import { Link } from 'react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { billingApi, billingKeys } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { flatten } from '@/lib/social-queries';
import { formatDateTime } from './ui';

/** /notifications — created only by real server-side events. */
export function NotificationsPage() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: billingKeys.notifications,
    queryFn: ({ pageParam }) => billingApi.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(q.data);
  const unread = rows.some((n) => !n.read);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        actions={
          unread ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await billingApi.markRead('all');
                await qc.invalidateQueries({ queryKey: billingKeys.notifications });
              }}
            >
              Mark all as read
            </Button>
          ) : undefined
        }
      />
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing yet">Payment, plan and promotion updates will show up here.</EmptyState>
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <ul className="space-y-2">
            {rows.map((n) => (
              <li key={n.id}>
                <Panel className={cn('p-4', !n.read && 'border-control-border')}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-text-1">
                      {!n.read && <span className="sr-only">Unread: </span>}
                      {n.title}
                    </p>
                    {!n.read && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" />}
                  </div>
                  <p className="mt-1 text-small text-text-2">{n.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-caption text-text-3">
                    <time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time>
                    {n.link && (
                      <Link
                        to={n.link}
                        className="text-signal underline-offset-2 hover:underline"
                        onClick={() => void billingApi.markRead([n.id]).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}
                      >
                        Open
                      </Link>
                    )}
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        </InfiniteList>
      )}
    </div>
  );
}
