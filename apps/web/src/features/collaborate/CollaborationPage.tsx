import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { COLLABORATION_STATUS_LABELS, COLLABORATION_TYPES, type CollaborationStatus, type CollaborationView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Avatar, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { timeAgo } from '@/features/feed/PostCard';
import { errorMessage } from '@/lib/api';
import { collabApi, collabKeys } from '@/lib/collaboration';

/** /collaborate/:id — the shared record: who, what, status, and the progress log (COL-005/006). */
export function CollaborationPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: collabKeys.one(id), queryFn: () => collabApi.one(id) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Collaboration c={q.data} />;
}

const ACTION_LABEL: Record<CollaborationStatus, string> = {
  ACTIVE: 'Resume',
  ON_HOLD: 'Put on hold',
  COMPLETED: 'Mark completed',
  CANCELLED: 'Close without finishing',
};

function Collaboration({ c }: { c: CollaborationView }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [change, setChange] = useState<CollaborationStatus | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (fn: () => Promise<CollaborationView>, success: string) => {
    setBusy(true);
    try {
      qc.setQueryData(collabKeys.one(c.id), await fn());
      await qc.invalidateQueries({ queryKey: collabKeys.list });
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const closed = c.status === 'COMPLETED' || c.status === 'CANCELLED';
  return (
    <article className="mx-auto max-w-3xl">
      <Link to="/collaborate" className="mb-3 inline-flex items-center gap-1 text-caption text-text-2 hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Collaborate
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant={c.status === 'ACTIVE' ? 'signal' : c.status === 'ON_HOLD' ? 'gold' : 'gray'}>
          {COLLABORATION_STATUS_LABELS[c.status]}
        </Pill>
        <span className="text-caption text-text-2">{COLLABORATION_TYPES[c.type]}</span>
      </div>
      <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight">{c.title}</h1>
      <p className="mt-1 text-caption text-text-3">
        Started {new Date(c.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        {c.dueAt && <> · due {new Date(c.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</>}
        {c.closedAt && <> · closed {new Date(c.closedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</>}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_--spacing(72)]">
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-caption font-semibold tracking-wide text-text-3 uppercase">The project</h2>
            <p className="mt-1 text-small whitespace-pre-line text-text-1">{c.summary}</p>
          </Panel>
          <section aria-labelledby="progress">
            <h2 id="progress" className="text-h3">
              Progress
            </h2>
            {!closed && (
              <form
                className="mt-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (note.trim() && (await save(() => collabApi.note(c.id, note.trim()), 'Note added'))) setNote('');
                }}
              >
                <Field label="Add a progress note">
                  {(a) => (
                    <Textarea
                      {...a}
                      value={note}
                      rows={2}
                      maxLength={2000}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Sent the stems; vocals booked for Saturday"
                    />
                  )}
                </Field>
                <Button type="submit" size="sm" disabled={busy || !note.trim()}>
                  Add note
                </Button>
              </form>
            )}
            <ol className="mt-4 space-y-3 border-l border-hairline-strong pl-4">
              {c.updates.map((u) => (
                <li key={u.id}>
                  <p className="text-caption text-text-3">
                    {u.author.name} · {timeAgo(u.createdAt)}
                    {u.status && <> · {COLLABORATION_STATUS_LABELS[u.status]}</>}
                  </p>
                  <p className="text-small text-text-1">{u.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="space-y-4">
          <Panel className="p-4">
            <h2 className="text-small font-semibold">People</h2>
            <ul className="mt-2 space-y-2">
              {c.participants.map((p) => (
                <li key={p.username}>
                  <Link to={`/u/${p.username}`} className="flex items-center gap-3 hover:text-signal">
                    <Avatar name={p.name} image={p.image} className="size-9 text-xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-small font-semibold">{p.name}</span>
                      <span className="block truncate text-caption text-text-2">{p.role}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {c.conversationId && (
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link to={`/messages/${c.conversationId}`}>
                  <MessageCircle /> Open conversation
                </Link>
              </Button>
            )}
          </Panel>
          {c.nextStatuses.length > 0 && (
            <Panel className="p-4">
              <h2 className="text-small font-semibold">Status</h2>
              <div className="mt-2 flex flex-col gap-2">
                {c.nextStatuses.map((s) => (
                  <Button key={s} size="sm" variant={s === 'COMPLETED' ? 'primary' : 'outline'} onClick={() => setChange(s)}>
                    {ACTION_LABEL[s]}
                  </Button>
                ))}
              </div>
            </Panel>
          )}
        </aside>
      </div>
      {change && (
        <Dialog open onClose={() => setChange(null)} title={ACTION_LABEL[change]}>
          {(change === 'COMPLETED' || change === 'CANCELLED') && (
            <p className="mb-3 text-sm text-text-2">This closes the collaboration. It can’t be reopened.</p>
          )}
          <Field label="A note for the other participant (optional)">
            {(a) => <Textarea {...a} value={changeNote} rows={3} maxLength={1000} onChange={(e) => setChangeNote(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setChange(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await save(() => collabApi.setStatus(c.id, change, changeNote.trim() || undefined), 'Status updated')) {
                  setChange(null);
                  setChangeNote('');
                }
              }}
            >
              {ACTION_LABEL[change]}
            </Button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
