import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  COLLABORATION_STATUS_LABELS,
  COLLABORATION_TYPES,
  REQUEST_STATUS_LABELS,
  type CollabRequestView,
  type CollaborationView,
} from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Avatar, EmptyState, PageHeader, PageLoading, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { timeAgo } from '@/features/feed/PostCard';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { collabApi, collabKeys } from '@/lib/collaboration';

const TABS = [
  { key: 'projects', label: 'Projects' },
  { key: 'incoming', label: 'Requests for you' },
  { key: 'sent', label: 'Sent' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** /collaborate — your projects, requests waiting for you, and what you've sent. */
export function CollaboratePage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.map((t) => t.key) as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'projects';
  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Collaborate"
        title="Make music with the right people"
        description="Send a structured request, talk it through in messages, and keep track of the project once it starts."
        actions={
          <Button asChild variant="outline">
            <Link to="/discover">
              <Search /> Find collaborators
            </Link>
          </Button>
        }
      />
      <div role="tablist" aria-label="Collaboration" className="mb-4 flex gap-1 overflow-x-auto border-b border-hairline-strong">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === 'projects' ? {} : { tab: t.key }, { replace: true })}
            className={cn(
              'min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold',
              tab === t.key ? 'border-signal text-signal' : 'border-transparent text-text-2 hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'projects' ? <Projects /> : <Requests box={tab} />}
    </div>
  );
}

const statusTone = (s: string) =>
  s === 'ACCEPTED' || s === 'ACTIVE' ? 'signal' : s === 'CLARIFICATION_REQUESTED' || s === 'ON_HOLD' ? 'gold' : 'gray';

function Projects() {
  const q = useQuery({ queryKey: collabKeys.list, queryFn: collabApi.list });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0)
    return (
      <EmptyState
        title="No projects yet"
        action={
          <Button asChild variant="outline">
            <Link to="/discover">Find collaborators</Link>
          </Button>
        }
      >
        Open a profile and choose <strong>Collaborate</strong>. When someone accepts, the project appears here.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-hairline-strong">
      {q.data.items.map((c) => (
        <ProjectRow key={c.id} c={c} />
      ))}
    </ul>
  );
}

function ProjectRow({ c }: { c: CollaborationView }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-4">
      <div className="flex -space-x-2">
        {c.participants.map((p) => (
          <Avatar key={p.username} name={p.name} image={p.image} className="size-9 border-2 border-surface-base text-xs" />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <Link to={`/collaborate/${c.id}`} className="font-semibold hover:text-signal">
          {c.title}
        </Link>
        <p className="text-caption text-text-2">
          {COLLABORATION_TYPES[c.type]} · {c.participants.map((p) => p.name).join(' & ')}
          {c.dueAt && <> · due {new Date(c.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</>}
        </p>
      </div>
      <Pill variant={statusTone(c.status)}>{COLLABORATION_STATUS_LABELS[c.status]}</Pill>
    </li>
  );
}

function Requests({ box }: { box: 'incoming' | 'sent' }) {
  const q = useQuery({ queryKey: collabKeys.requests(box), queryFn: () => collabApi.requests(box) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0)
    return (
      <EmptyState title={box === 'incoming' ? 'No requests for you yet' : 'You haven’t sent any requests'}>
        {box === 'incoming'
          ? 'When someone asks you to collaborate, it shows up here.'
          : 'Find someone on Discover and choose Collaborate on their profile.'}
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-hairline-strong">
      {q.data.items.map((r) => (
        <RequestRow key={r.id} r={r} />
      ))}
    </ul>
  );
}

function RequestRow({ r }: { r: CollabRequestView }) {
  const other = r.direction === 'incoming' ? r.sender : r.recipient;
  const waitingOnYou = r.actions.some((a) => a !== 'cancel');
  return (
    <li className="flex flex-wrap items-center gap-3 py-4">
      <Avatar name={other.name} image={other.image} className="size-10 text-xs" />
      <div className="min-w-0 flex-1">
        <Link to={`/collaborate/requests/${r.id}`} className="font-semibold hover:text-signal">
          {r.title}
        </Link>
        <p className="text-caption text-text-2">
          {r.direction === 'incoming' ? `From ${other.name}` : `To ${other.name}`} · {r.role} · {timeAgo(r.createdAt)}
        </p>
      </div>
      {waitingOnYou && <span className="text-caption text-signal">Your turn</span>}
      <Pill variant={statusTone(r.status)}>{REQUEST_STATUS_LABELS[r.status]}</Pill>
    </li>
  );
}
