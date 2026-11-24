import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { REPORT_REASONS } from '@muzikhub/shared';
import { ResponsiveImage } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { adminApi, type ReportDetail } from './admin-api';
import { describeAction } from './AuditPage';
import { TARGET_LABEL } from './ReportsPage';
import { AdminHeader, Ago, ReasonDialog, ReportStatusTag, Section, StatusTag, Tag, useAdminAction } from './ui';

export function ReportDetailPage() {
  const { id = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'report', id], queryFn: () => adminApi.report(id) });
  if (isPending) return <PageLoading />;
  if (isError) return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  return <ReportWorkspace r={data} />;
}

type Dialog = null | 'remove' | 'escalate' | 'resolve' | 'dismiss';

function ReportWorkspace({ r }: { r: ReportDetail }) {
  const act = useAdminAction();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const [includeRelated, setIncludeRelated] = useState(true);
  const open = r.status === 'PENDING' || r.status === 'UNDER_REVIEW';
  const t = r.target;

  return (
    <div>
      <Link to="/admin/reports" className="mb-3 inline-flex items-center gap-1 text-xs text-sage hover:text-foreground">
        <ArrowLeft className="size-3" /> Reports
      </Link>
      <AdminHeader
        title={`${REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? r.reason} · ${TARGET_LABEL[r.targetType]}`}
        description={
          <>
            Reported <Ago iso={r.createdAt} /> by {r.reporter.name} · <ReportStatusTag status={r.status} escalated={r.escalated} />
          </>
        }
        actions={
          open && (
            <>
              {!r.assignee ? (
                <Button size="sm" onClick={() => void act(() => adminApi.assign(r.id, 'me'), 'You are reviewing this report')}>
                  Take this report
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void act(() => adminApi.assign(r.id, 'nobody'), 'Released')}>
                  Release ({r.assignee.name})
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section
            title="Reported content"
            action={
              t.link && (
                <a
                  href={t.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-mint-soft hover:underline"
                >
                  View in app <ExternalLink className="size-3" />
                </a>
              )
            }
          >
            {!t.exists ? (
              <p className="px-3 py-4 text-sm text-sage">
                This content no longer exists (deleted by its owner). You can still resolve or dismiss the report.
              </p>
            ) : (
              <div className="space-y-3 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {t.owner && (
                    <>
                      By{' '}
                      <Link to={`/admin/users/${t.ownerId}`} className="font-semibold text-mint-soft hover:underline">
                        {t.owner.name}
                      </Link>{' '}
                      <span className="text-sage">@{t.owner.username}</span>
                    </>
                  )}
                  {t.accountStatus && <StatusTag status={t.accountStatus} />}
                  {t.removed && <Tag color="red">Removed: {t.removalReason}</Tag>}
                </div>
                <p className="font-semibold">{t.title}</p>
                {t.text && <p className="text-sm whitespace-pre-line text-[#d6ece0]">{t.text}</p>}
                {t.media && t.media.length > 0 && (
                  <div className="grid max-w-md grid-cols-2 gap-2">
                    {t.media.map((m) =>
                      m.kind === 'IMAGE' ? (
                        <ResponsiveImage key={m.id} media={m} alt="Reported media" className="rounded-lg" sizes="200px" />
                      ) : (
                        <a
                          key={m.id}
                          href={m.urls.src}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-line p-3 text-xs"
                        >
                          {m.kind.toLowerCase()} file ↗
                        </a>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
            {r.details && (
              <p className="mx-3 mb-2 rounded-lg bg-[#0d2720] px-3 py-2 text-sm">
                <span className="text-sage">Reporter's note: </span>
                {r.details}
              </p>
            )}
          </Section>

          {open && (
            <Section title="Decide">
              {!r.canDecide && (
                <p className="px-3 pb-2 text-sm text-gold">
                  This report is escalated: an administrator must resolve or dismiss it. You can still add notes.
                </p>
              )}
              <div className="flex flex-wrap gap-2 px-3 py-2">
                {t.exists && t.moderationType && !t.removed && (
                  <Button size="sm" variant="destructive" onClick={() => setDialog('remove')}>
                    Remove content
                  </Button>
                )}
                {t.ownerId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/admin/users/${t.ownerId}`}>Account actions</Link>
                  </Button>
                )}
                {!r.escalated && (
                  <Button size="sm" variant="outline" onClick={() => setDialog('escalate')}>
                    Escalate to admin
                  </Button>
                )}
                {r.canDecide && (
                  <Button size="sm" onClick={() => setDialog('resolve')}>
                    Resolve
                  </Button>
                )}
                {r.canDecide && (
                  <Button size="sm" variant="quiet" onClick={() => setDialog('dismiss')}>
                    Dismiss
                  </Button>
                )}
              </div>
              {r.otherReports.filter((o) => o.status === 'PENDING' || o.status === 'UNDER_REVIEW').length > 0 && r.canDecide && (
                <label className="flex min-h-10 items-center gap-2 px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={includeRelated}
                    onChange={(e) => setIncludeRelated(e.target.checked)}
                    className="size-4 accent-[#28dca0]"
                  />
                  Also close the other open reports about this content
                </label>
              )}
            </Section>
          )}
          {!open && r.resolution && (
            <Section title="Decision">
              <p className="px-3 py-2 text-sm">{r.resolution}</p>
              <p className="px-3 pb-2 text-xs text-sage">
                {r.resolvedBy?.name ?? 'Staff'} · <Ago iso={r.resolvedAt} />
              </p>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title={`Internal notes (${r.notes.length})`}>
            <p className="px-3 pb-2 text-[11px] text-sage-dim">Visible to staff only. Notes can't be edited.</p>
            <ul className="space-y-2 px-3">
              {r.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-[#0d2720] px-3 py-2 text-sm">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-[11px] text-sage">
                    {n.author?.name ?? 'Staff'} · <Ago iso={n.createdAt} />
                  </p>
                </li>
              ))}
            </ul>
            <form
              className="space-y-2 px-3 py-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => adminApi.note(r.id, note.trim()), 'Note added')) setNote('');
              }}
            >
              <Textarea
                aria-label="Add an internal note"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you check? What did you decide and why?"
                className="min-h-16"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!note.trim()}>
                Add note
              </Button>
            </form>
          </Section>

          <Section title={`Other reports about this content (${r.otherReports.length})`}>
            {r.otherReports.length === 0 ? (
              <p className="px-3 py-2 text-sm text-sage">None.</p>
            ) : (
              <ul className="divide-y divide-line">
                {r.otherReports.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <Link to={`/admin/reports/${o.id}`} className="hover:text-mint">
                      {REPORT_REASONS[o.reason as keyof typeof REPORT_REASONS]} · {o.reporter.name}
                    </Link>
                    <ReportStatusTag status={o.status} escalated={o.escalated} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="History">
            <ol className="space-y-1.5 px-3 py-2 text-sm">
              <li className="text-sage">
                Reported <Ago iso={r.createdAt} />
              </li>
              {r.history.map((h) => (
                <li key={h.id}>
                  {describeAction(h.action)}{' '}
                  <span className="text-sage">
                    · <Ago iso={h.createdAt} />
                    {h.reason && ` — ${h.reason}`}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'remove'}
        onClose={() => setDialog(null)}
        title="Remove this content"
        destructive
        confirmLabel="Remove content"
        description="It will be hidden everywhere. The owner keeps it (marked as removed) and it can be restored later."
        onConfirm={(reason) => act(() => adminApi.removeContent(t.moderationType!, r.targetId, reason, r.id), 'Content removed')}
      />
      <ReasonDialog
        open={dialog === 'escalate'}
        onClose={() => setDialog(null)}
        title="Escalate to an administrator"
        confirmLabel="Escalate"
        onConfirm={(reason) => act(() => adminApi.escalate(r.id, reason), 'Escalated')}
      />
      <ReasonDialog
        open={dialog === 'resolve'}
        onClose={() => setDialog(null)}
        title="Resolve report"
        confirmLabel="Resolve"
        reasonLabel="Decision (what was done)"
        description="Resolve when the report was valid and you've taken action."
        onConfirm={async (reason) => {
          const ok = await act(() => adminApi.close(r.id, 'resolve', reason, includeRelated), 'Report resolved');
          if (ok) await qc.invalidateQueries({ queryKey: ['admin'] });
          return ok;
        }}
      />
      <ReasonDialog
        open={dialog === 'dismiss'}
        onClose={() => setDialog(null)}
        title="Dismiss report"
        confirmLabel="Dismiss"
        reasonLabel="Why no action is needed"
        onConfirm={(reason) => act(() => adminApi.close(r.id, 'dismiss', reason, includeRelated), 'Report dismissed')}
      />
    </div>
  );
}
