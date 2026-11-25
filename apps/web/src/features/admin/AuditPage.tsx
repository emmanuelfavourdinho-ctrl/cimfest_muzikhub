import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { flatten } from '@/lib/social-queries';
import { adminApi, type AuditEntry } from './admin-api';
import { AdminHeader, Ago, DataTable, EmptyRow } from './ui';

const LABELS: Record<string, string> = {
  'user.status.restricted': 'Restricted account',
  'user.status.suspended': 'Suspended account',
  'user.status.banned': 'Banned account',
  'user.status.reinstate': 'Reinstated account',
  'user.status.expired': 'Suspension ended',
  'user.role.change': 'Changed role',
  'user.role.grant_initial': 'Granted first administrator',
  'user.two_factor.reset': 'Reset two-factor',
  'content.remove': 'Removed content',
  'content.restore': 'Restored content',
  'report.assign': 'Took report',
  'report.unassign': 'Released report',
  'report.note': 'Added note',
  'report.escalate': 'Escalated report',
  'report.resolve': 'Resolved report',
  'report.dismiss': 'Dismissed report',
  'catalogue.price.change': 'Changed price',
  'payment.refund': 'Refunded payment',
  'payment.recheck': 'Re-checked payment',
  'payment.retry_fulfilment': 'Retried fulfilment',
  'payment.approve_late': 'Approved late payment',
  'promotion.end': 'Ended promotion',
  'catalogue.availability.change': 'Changed availability',
  'competition.publish': 'Published competition',
  'competition.extend': 'Extended competition deadline',
  'competition.cancel': 'Cancelled competition',
  'competition.entry.disqualify': 'Disqualified entry',
  'competition.results.publish': 'Published results',
  'competition.dispute.resolve': 'Decided dispute',
  'community.discussion.remove': 'Removed discussion',
  'community.comment.remove': 'Removed community comment',
};
export const describeAction = (action: string) => LABELS[action] ?? action;

/** Read-only, append-only record of every administrative action (administrators only). */
export function AuditPage() {
  const [targetId, setTargetId] = useState('');
  const [action, setAction] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', targetId, action],
    queryFn: ({ pageParam }) => adminApi.audit({ cursor: pageParam, targetId: targetId.trim() || undefined, action: action || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(query.data);

  return (
    <div>
      <AdminHeader title="Audit log" description="Every administrative action, who took it and why. Entries can't be edited or deleted." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Filter by target id"
          placeholder="Target id (user, report, content…)"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-11 rounded-s border border-control-border bg-surface-raised px-3 text-sm sm:w-56"
        >
          <option value="">All actions</option>
          <option value="user.">Account actions</option>
          <option value="content.">Content moderation</option>
          <option value="report.">Reports</option>
          <option value="catalogue.">Pricing</option>
          <option value="payment.">Payments</option>
          <option value="promotion.">Promotions</option>
          <option value="competition.">Competitions</option>
          <option value="community.">Communities</option>
        </select>
      </div>
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
          <DataTable label="Audit log">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow cols={6}>No entries match.</EmptyRow> : rows.map((a) => <AuditRow key={a.id} a={a} />)}
            </tbody>
          </DataTable>
        </InfiniteList>
      )}
    </div>
  );
}

function AuditRow({ a }: { a: AuditEntry }) {
  return (
    <tr>
      <td className="whitespace-nowrap text-text-2">
        <Ago iso={a.createdAt} />
      </td>
      <td>
        {a.actor ? (
          <>
            {a.actor.name} <span className="text-text-2">({a.actorRole?.toLowerCase()})</span>
          </>
        ) : (
          <span className="font-mono text-xs text-text-2">{a.actorLabel ?? 'system'}</span>
        )}
      </td>
      <td className="whitespace-nowrap">{describeAction(a.action)}</td>
      <td className="font-mono text-xs">
        {a.targetType.toLowerCase()}
        <br />
        <span className="text-text-2">{a.targetId}</span>
      </td>
      <td className="max-w-65 text-text-2">{a.reason ?? '—'}</td>
      <td>
        {/* The <summary> text is the control's label. */}
        {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
        <details>
          <summary className="cursor-pointer text-xs text-signal">Before / after</summary>
          <pre className="mt-1 max-w-80 overflow-x-auto rounded bg-surface-base p-2 text-xs leading-snug">
            {JSON.stringify({ before: a.before, after: a.after }, null, 2)}
          </pre>
        </details>
      </td>
    </tr>
  );
}
