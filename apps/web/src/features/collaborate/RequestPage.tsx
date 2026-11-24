import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { COLLABORATION_TYPES, REQUEST_STATUS_LABELS, type CollabRequestView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Avatar, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { timeAgo } from '@/features/feed/PostCard';
import { errorMessage } from '@/lib/api';
import { collabApi, collabKeys } from '@/lib/collaboration';

/** /collaborate/requests/:id — the request, its state, and only the actions you may take now. */
export function RequestPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: collabKeys.request(id), queryFn: () => collabApi.request(id) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Request r={q.data} />;
}

type Prompted = 'decline' | 'clarify' | 'answer' | 'accept';
const PROMPTS: Record<Prompted, { title: string; label: string; required: boolean; confirm: string }> = {
  accept: { title: 'Accept this request', label: 'A note (optional)', required: false, confirm: 'Accept and start' },
  decline: { title: 'Decline this request', label: 'A short reason (optional, shown to them)', required: false, confirm: 'Decline' },
  clarify: { title: 'Ask a question first', label: 'Your question', required: true, confirm: 'Send question' },
  answer: { title: 'Answer their question', label: 'Your answer', required: true, confirm: 'Send answer' },
};

function Request({ r }: { r: CollabRequestView }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Prompted | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const other = r.direction === 'incoming' ? r.sender : r.recipient;
  async function act(action: Prompted | 'cancel', value?: string) {
    setBusy(true);
    try {
      qc.setQueryData(collabKeys.request(r.id), await collabApi.act(r.id, action, value));
      await qc.invalidateQueries({ queryKey: ['collab'] });
      setOpen(null);
      setText('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="mx-auto max-w-2xl">
      <Link
        to={`/collaborate${r.direction === 'incoming' ? '?tab=incoming' : '?tab=sent'}`}
        className="mb-3 inline-flex items-center gap-1 text-caption text-text-2 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Collaborate
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant={r.status === 'ACCEPTED' ? 'signal' : r.status === 'CLARIFICATION_REQUESTED' ? 'gold' : 'gray'}>
          {REQUEST_STATUS_LABELS[r.status]}
        </Pill>
        <span className="text-caption text-text-2">{COLLABORATION_TYPES[r.type]}</span>
      </div>
      <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight">{r.title}</h1>
      <p className="mt-2 flex items-center gap-2 text-small text-text-2">
        <Avatar name={other.name} image={other.image} className="size-7 text-xs" />
        {r.direction === 'incoming' ? 'From' : 'To'}{' '}
        <Link to={`/u/${other.username}`} className="font-semibold text-text-1 hover:text-signal">
          {other.name}
        </Link>{' '}
        · {timeAgo(r.createdAt)}
      </p>

      <Panel className="mt-4 space-y-3 p-5">
        <div>
          <h2 className="text-caption font-semibold tracking-wide text-text-3 uppercase">Role requested</h2>
          <p className="text-body text-text-1">{r.role}</p>
        </div>
        <div>
          <h2 className="text-caption font-semibold tracking-wide text-text-3 uppercase">About the project</h2>
          <p className="text-small whitespace-pre-line text-text-1">{r.description}</p>
        </div>
        {r.deadline && (
          <p className="text-small text-text-2">
            Deadline: {new Date(r.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
        {r.references.length > 0 && (
          <ul className="space-y-1 text-small">
            {r.references.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all text-signal underline-offset-2 hover:underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {r.clarificationQuestion && (
        <Panel className="mt-3 p-4 text-small">
          <p className="text-text-2">
            <strong className="text-text-1">{r.recipient.name} asked:</strong> {r.clarificationQuestion}
          </p>
          {r.clarificationAnswer && (
            <p className="mt-2 text-text-2">
              <strong className="text-text-1">{r.sender.name} answered:</strong> {r.clarificationAnswer}
            </p>
          )}
        </Panel>
      )}
      {r.responseNote && <p className="mt-3 text-small text-text-2">Note: “{r.responseNote}”</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {r.actions.includes('accept') && <Button onClick={() => setOpen('accept')}>Accept</Button>}
        {r.actions.includes('clarify') && (
          <Button variant="outline" onClick={() => setOpen('clarify')}>
            Ask a question
          </Button>
        )}
        {r.actions.includes('answer') && <Button onClick={() => setOpen('answer')}>Answer the question</Button>}
        {r.actions.includes('decline') && (
          <Button variant="ghost" onClick={() => setOpen('decline')}>
            Decline
          </Button>
        )}
        {r.actions.includes('cancel') && (
          <Button variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Withdraw request
          </Button>
        )}
        {r.collaborationId && (
          <Button asChild>
            <Link to={`/collaborate/${r.collaborationId}`}>Open the collaboration</Link>
          </Button>
        )}
        {r.conversationId && (
          <Button asChild variant="outline">
            <Link to={`/messages/${r.conversationId}`}>
              <MessageCircle /> Message {other.name}
            </Link>
          </Button>
        )}
      </div>

      {open && (
        <Dialog open onClose={() => setOpen(null)} title={PROMPTS[open].title}>
          <Field label={PROMPTS[open].label}>
            {(a) => <Textarea {...a} value={text} rows={4} maxLength={2000} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant={open === 'decline' ? 'destructive' : 'primary'}
              disabled={busy || (PROMPTS[open].required && text.trim().length < 2)}
              onClick={() => void act(open, text.trim() || undefined)}
            >
              {PROMPTS[open].confirm}
            </Button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
