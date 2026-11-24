import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { adminApi } from './admin-api';
import { AdminHeader, Ago, Section, Stat, useAdmin } from './ui';
import { describeAction } from './AuditPage';

const PENDING_LABELS: Record<string, string> = {
  communities: 'Communities',
  competitions: 'Competitions',
  opportunities: 'Opportunities',
  payments: 'Payments & revenue',
  announcements: 'Announcements',
};

/** Live operational overview. Every figure is a database query; nothing is estimated. */
export function OverviewPage() {
  const { me } = useAdmin();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: adminApi.overview,
    refetchInterval: 60_000,
  });
  if (isPending) return <PageLoading />;
  if (isError) return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  const { users, content, moderation, staff } = data;
  const maxWeek = Math.max(1, ...users.weeklySignups.map((w) => w.signups));
  const needsAttention = moderation.openReports > 0 || staff.withoutTwoFactor > 0;

  return (
    <div>
      <AdminHeader
        title="Overview"
        description={
          <>
            Live figures from the database · updated <Ago iso={data.generatedAt} />
          </>
        }
      />

      {/* What needs attention first — the point of the console. */}
      <div className={`mb-5 rounded-xl border px-4 py-3 ${needsAttention ? 'border-[#7a692d] bg-[#2a2410]' : 'border-line bg-[#081d17]'}`}>
        {needsAttention ? (
          <ul className="space-y-1.5 text-sm">
            {moderation.openReports > 0 && (
              <li className="flex flex-wrap items-center gap-x-2">
                <AlertTriangle className="size-4 text-gold" aria-hidden />
                <strong>{moderation.openReports}</strong> open {moderation.openReports === 1 ? 'report' : 'reports'}
                <span className="text-sage">
                  · {moderation.unassigned} unassigned · {moderation.escalated} escalated · oldest <Ago iso={moderation.oldestOpenAt} />
                </span>
                <Link to="/admin/reports" className="inline-flex items-center gap-1 text-mint-soft hover:underline">
                  Review <ArrowRight className="size-3" />
                </Link>
              </li>
            )}
            {staff.withoutTwoFactor > 0 && (
              <li className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-gold" aria-hidden />
                {staff.withoutTwoFactor} staff {staff.withoutTwoFactor === 1 ? 'account has' : 'accounts have'} not set up two-step
                verification (they can't use the console yet)
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-sage">Nothing needs attention: no open reports.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Members">
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Stat label="Registered" value={users.total} />
            <Stat label="New, 7 days" value={users.new7d} />
            <Stat label="New, 30 days" value={users.new30d} />
            <Stat label="Active, 7 days" value={users.active7d} hint="had a signed-in session" />
          </dl>
          <div className="mt-2 border-t border-line px-3 pt-3">
            <p className="mb-2 text-xs text-sage">Sign-ups per week (last 12 weeks)</p>
            <div
              className="flex h-16 items-end gap-1"
              role="img"
              aria-label={`Weekly sign-ups: ${users.weeklySignups.map((w) => w.signups).join(', ')}`}
            >
              {users.weeklySignups.map((w) => (
                <div
                  key={w.weekStart}
                  title={`Week of ${w.weekStart}: ${w.signups}`}
                  className="flex-1 rounded-t bg-emerald/70"
                  style={{ height: `${Math.max(2, (w.signups / maxWeek) * 100)}%`, opacity: w.signups ? 1 : 0.25 }}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2.5 text-xs text-sage">
            {Object.entries(users.byStatus).map(([s, n]) => (
              <Link key={s} to={`/admin/users?status=${s}`} className="hover:text-foreground">
                {s.charAt(0) + s.slice(1).toLowerCase()}: <strong className="text-foreground tabular-nums">{n}</strong>
              </Link>
            ))}
          </div>
        </Section>

        <Section
          title="Moderation"
          action={
            <Link to="/admin/reports" className="text-xs text-mint-soft hover:underline">
              Reports queue
            </Link>
          }
        >
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Stat label="Open reports" value={moderation.openReports} />
            <Stat label="Unassigned" value={moderation.unassigned} />
            <Stat label="Escalated" value={moderation.escalated} />
            <Stat label="Closed, 7 days" value={moderation.closed7d} />
          </dl>
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
            <Stat label="Removed content, 30 days" value={content.removed30d} />
            <Stat label="Admins" value={staff.admins} />
            <Stat label="Moderators" value={staff.moderators} />
          </dl>
        </Section>

        <Section title="Creative content">
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Stat label="Published work" value={content.publishedWork} hint="public portfolio items" />
            <Stat label="Feed posts" value={content.posts} />
            <Stat label="Posts, 7 days" value={content.posts7d} />
            <Stat label="Comments, 7 days" value={content.comments7d} />
          </dl>
        </Section>

        <Section title="Not built yet">
          <p className="px-3 pt-1 pb-2 text-xs text-sage">
            These areas appear here once the corresponding parts of MuzikHub exist. No figures are shown for them.
          </p>
          <ul className="flex flex-wrap gap-2 px-3 pb-3">
            {data.pending.map((p) => (
              <li key={p} className="rounded-md border border-dashed border-line px-2 py-1 text-xs text-sage">
                {PENDING_LABELS[p] ?? p}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {data.recentAudit && me.permissions.includes('audit.view') && (
        <div className="mt-4">
          <Section
            title="Recent staff activity"
            action={
              <Link to="/admin/audit" className="text-xs text-mint-soft hover:underline">
                Audit log
              </Link>
            }
          >
            {data.recentAudit.length === 0 ? (
              <p className="px-3 py-4 text-sm text-sage">No administrative actions yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentAudit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {describeAction(a.action)}{' '}
                      <span className="font-mono text-xs text-sage">
                        {a.targetType.toLowerCase()} {a.targetId.slice(0, 8)}
                      </span>
                      {a.reason && <span className="text-sage"> — {a.reason}</span>}
                    </span>
                    <span className="text-xs text-sage-dim">
                      <Ago iso={a.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
