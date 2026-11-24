import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CalendarClock, MapPin, Plus } from 'lucide-react';
import { OPPORTUNITY_TYPE_KEYS, OPPORTUNITY_TYPES, type OpportunityView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { EmptyState, PageHeader, PageLoading, Panel, Pill, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';

export const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function OpportunityCard({ o }: { o: OpportunityView }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{OPPORTUNITY_TYPES[o.type]}</Pill>
        {o.status !== 'PUBLISHED' && <Pill variant="gray">{o.status === 'DRAFT' ? 'Draft' : 'Closed'}</Pill>}
        {o.status === 'PUBLISHED' && !o.acceptingApplications && <Pill variant="gray">Deadline passed</Pill>}
      </div>
      <h2 className="mt-3 text-h3">
        <Link to={`/opportunities/${o.id}`} className="hover:text-signal">
          {o.title}
        </Link>
      </h2>
      <p className="mt-1 line-clamp-2 text-small text-text-2">{o.description}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-2">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" /> Apply by {formatDeadline(o.deadline)}
        </span>
        {(o.location || o.remote) && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" /> {[o.location, o.remote && 'Remote'].filter(Boolean).join(' · ')}
          </span>
        )}
        <span>by {o.organiser.name}</span>
      </p>
    </Panel>
  );
}

export function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? '';
  const open = params.get('open') !== 'false';
  const [location, setLocation] = useState(params.get('location') ?? '');
  const { data: me } = useMe();
  const status = useQuery({ queryKey: ['opportunities', 'organiser-status'], queryFn: api.organiserStatus, enabled: Boolean(me) });
  const filters = { type: type || undefined, location: params.get('location') || undefined, open: open ? undefined : 'false' };
  const query = useInfiniteQuery({
    queryKey: ['opportunities', 'list', filters],
    queryFn: ({ pageParam }) => api.opportunities({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Opportunities"
        title="Gigs, auditions, events and jobs"
        description="Real opportunities from approved organisers. Apply before the deadline."
        actions={
          status.data?.canOrganise ? (
            <Button asChild>
              <Link to="/opportunities/new">
                <Plus /> Post an opportunity
              </Link>
            </Button>
          ) : null
        }
      />
      <Panel className="mb-4 p-4">
        <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
          <ToggleChip selected={!type} onClick={() => set('type', null)}>
            All types
          </ToggleChip>
          {OPPORTUNITY_TYPE_KEYS.map((t) => (
            <ToggleChip key={t} selected={type === t} onClick={() => set('type', type === t ? null : t)}>
              {OPPORTUNITY_TYPES[t]}
            </ToggleChip>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            set('location', location.trim() || null);
          }}
        >
          <Field label="Location" className="mb-0 min-w-0 flex-1">
            {(a) => <Input {...a} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or region" />}
          </Field>
          <Button type="submit" variant="outline">
            Filter
          </Button>
          <label className="flex min-h-11 items-center gap-2 text-small text-text-2">
            <input
              type="checkbox"
              checked={!open}
              onChange={(e) => set('open', e.target.checked ? 'false' : null)}
              className="size-4 accent-signal"
            />
            Include closed
          </label>
        </form>
      </Panel>

      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No opportunities match yet">
          {type || params.get('location')
            ? 'Try another type or location.'
            : 'When approved organisers publish gigs, auditions, events or jobs, they appear here.'}
        </EmptyState>
      ) : (
        <InfiniteList
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
          isError={query.isError}
        >
          <ul className="space-y-3">
            {items.map((o) => (
              <li key={o.id}>
                <OpportunityCard o={o} />
              </li>
            ))}
          </ul>
        </InfiniteList>
      )}
    </div>
  );
}
