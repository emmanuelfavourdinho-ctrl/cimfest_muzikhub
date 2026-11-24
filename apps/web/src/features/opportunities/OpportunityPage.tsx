import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, MapPin, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { OPPORTUNITY_TYPES, type ApplicationView, type OpportunityView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Textarea } from '@/components/ui/form';
import { Avatar, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { formatDeadline } from './OpportunitiesPage';

const STATUS_LABEL: Record<ApplicationView['status'], string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  ACCEPTED: 'Accepted',
  REJECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
};

export function OpportunityPage() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['opportunities', 'detail', id], queryFn: () => api.opportunity(id) });
  if (query.isPending) return <PageLoading />;
  if (query.isError) {
    if (query.error instanceof ApiRequestError && query.error.status === 404) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <h1 className="text-h2">Opportunity not found</h1>
          <p className="mt-2 text-text-2">It may have been removed, or it isn't published yet.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/opportunities">All opportunities</Link>
          </Button>
        </div>
      );
    }
    return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  return <Detail o={query.data} />;
}

function Detail({ o }: { o: OpportunityView }) {
  const qc = useQueryClient();
  const refresh = (next: OpportunityView) => {
    qc.setQueryData(['opportunities', 'detail', o.id], next);
    void qc.invalidateQueries({ queryKey: ['opportunities', 'list'] });
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/opportunities" className="mb-3 inline-flex min-h-11 items-center gap-1 text-small text-text-2 hover:text-text-1">
        <ArrowLeft className="size-4" /> Opportunities
      </Link>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{OPPORTUNITY_TYPES[o.type]}</Pill>
          {o.status === 'DRAFT' && <Pill variant="gray">Draft — only you can see this</Pill>}
          {o.status === 'CLOSED' && <Pill variant="gray">Closed</Pill>}
          {o.status === 'PUBLISHED' && !o.acceptingApplications && <Pill variant="gray">Deadline passed</Pill>}
        </div>
        <h1 className="mt-3 text-h2">{o.title}</h1>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-small text-text-2">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-4" /> Apply by {formatDeadline(o.deadline)}
          </span>
          {(o.location || o.remote) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-4" /> {[o.location, o.remote && 'Remote'].filter(Boolean).join(' · ')}
            </span>
          )}
        </p>
        <Link to={`/u/${o.organiser.username}`} className="mt-4 inline-flex min-h-11 items-center gap-2 text-small hover:text-signal">
          <Avatar name={o.organiser.name} image={o.organiser.image} className="size-8 text-xs" /> {o.organiser.name}
        </Link>
        <h2 className="mt-5 text-label text-text-2 uppercase">Description</h2>
        <p className="mt-2 whitespace-pre-line text-body">{o.description}</p>
        {o.requirements && (
          <>
            <h2 className="mt-5 text-label text-text-2 uppercase">Requirements</h2>
            <p className="mt-2 whitespace-pre-line text-body">{o.requirements}</p>
          </>
        )}
      </Panel>
      {o.isOwner ? <OrganiserPanel o={o} onChange={refresh} /> : <ApplyPanel o={o} onChange={refresh} />}
    </div>
  );
}

function ApplyPanel({ o, onChange }: { o: OpportunityView; onChange: (o: OpportunityView) => void }) {
  const { data: me } = useMe();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per application attempt: a retry after a dropped connection is replayed, not refused.
  const key = useRef(crypto.randomUUID());
  const mine = o.myApplication;
  const active = mine && mine.status !== 'WITHDRAWN';

  if (!me) {
    return (
      <Panel className="mt-4 p-5">
        <p className="text-body">Sign in to apply.</p>
        <Button asChild className="mt-3">
          <Link to={`/login?next=${encodeURIComponent(`/opportunities/${o.id}`)}`}>Sign in</Link>
        </Button>
      </Panel>
    );
  }
  async function run(fn: () => Promise<OpportunityView>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      toast.success(ok);
      key.current = crypto.randomUUID();
      setMessage('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel className="mt-4 p-5">
      <h2 className="text-h3">Your application</h2>
      <FormError message={error} />
      {active ? (
        <>
          <p className="mt-2 text-body">
            Status: <strong>{STATUS_LABEL[mine.status]}</strong>
          </p>
          <p className="mt-1 text-small whitespace-pre-line text-text-2">{mine.message}</p>
          {(mine.status === 'SUBMITTED' || mine.status === 'SHORTLISTED') && o.acceptingApplications && (
            <Button
              variant="outline"
              className="mt-3"
              disabled={busy}
              onClick={() => void run(() => api.withdrawApplication(o.id), 'Application withdrawn')}
            >
              Withdraw application
            </Button>
          )}
        </>
      ) : o.acceptingApplications ? (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.applyToOpportunity(o.id, message.trim(), key.current), 'Application sent');
          }}
        >
          <Field label="Message to the organiser" hint="Who you are and why you're a fit. Links to your work help.">
            {(a) => <Textarea {...a} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} />}
          </Field>
          <Button type="submit" disabled={busy || !message.trim()}>
            {busy ? 'Sending…' : mine ? 'Apply again' : 'Apply'}
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-text-2">This opportunity is no longer accepting applications.</p>
      )}
    </Panel>
  );
}

function OrganiserPanel({ o, onChange }: { o: OpportunityView; onChange: (o: OpportunityView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<OpportunityView>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      toast.success(ok);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel className="mt-4 p-5">
        <h2 className="text-h3">Manage</h2>
        <FormError message={error} />
        <div className="mt-3 flex flex-wrap gap-2">
          {o.status !== 'CLOSED' && (
            <Button asChild variant="outline">
              <Link to={`/opportunities/${o.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )}
          {o.status === 'DRAFT' && (
            <Button disabled={busy} onClick={() => void run(() => api.publishOpportunity(o.id), 'Published')}>
              Publish
            </Button>
          )}
          {o.status === 'PUBLISHED' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => api.closeOpportunity(o.id), 'Closed to new applications')}
            >
              Close applications
            </Button>
          )}
        </div>
      </Panel>
      {o.status !== 'DRAFT' && <Applicants id={o.id} count={o.applicationCount ?? 0} />}
    </>
  );
}

function Applicants({ id, count }: { id: string; count: number }) {
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['opportunities', 'applications', id],
    queryFn: ({ pageParam }) => api.applications(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  async function decide(a: ApplicationView, status: 'SHORTLISTED' | 'ACCEPTED' | 'REJECTED') {
    try {
      await api.decideApplication(a.id, status);
      toast.success(`${a.applicant.name}: ${STATUS_LABEL[status].toLowerCase()}`);
      await qc.invalidateQueries({ queryKey: ['opportunities', 'applications', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel className="mt-4 p-5">
      <h2 className="text-h3">Applicants ({count})</h2>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <p className="mt-2 text-text-2">No applications yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {items.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/u/${a.applicant.username}`} className="inline-flex min-h-11 items-center gap-2 font-semibold hover:text-signal">
                  <Avatar name={a.applicant.name} image={a.applicant.image} className="size-8 text-xs" /> {a.applicant.name}
                </Link>
                <Pill variant={a.status === 'ACCEPTED' ? 'signal' : 'gray'}>{STATUS_LABEL[a.status]}</Pill>
              </div>
              <p className="mt-1 text-small whitespace-pre-line text-text-2">{a.message}</p>
              {(a.status === 'SUBMITTED' || a.status === 'SHORTLISTED') && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.status === 'SUBMITTED' && (
                    <Button size="sm" variant="outline" onClick={() => void decide(a, 'SHORTLISTED')}>
                      Shortlist
                    </Button>
                  )}
                  <Button size="sm" onClick={() => void decide(a, 'ACCEPTED')}>
                    Accept
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => void decide(a, 'REJECTED')}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
