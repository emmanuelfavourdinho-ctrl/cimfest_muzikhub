import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { MapPin, Search, X } from 'lucide-react';
import {
  CREATIVE_ROLES,
  GENRE_KEYS,
  GENRES,
  PORTFOLIO_TYPE_KEYS,
  PORTFOLIO_TYPES,
  type CreativeRole,
  type PersonCard as PersonCardData,
} from '@muzikhub/shared';
import { ResponsiveImage } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, PageHeader, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { PortfolioCard, PortfolioGrid } from '@/features/portfolio/PortfolioCard';
import { api, errorMessage } from '@/lib/api';
import { flatten, socialKeys } from '@/lib/social-queries';

/** Roles shown as quick filter chips (the prototype's filter row); all roles work via the API. */
const QUICK_ROLES: CreativeRole[] = ['ARTIST', 'SINGER', 'RAPPER', 'PRODUCER', 'BEATMAKER', 'DJ', 'SONGWRITER', 'AUDIO_ENGINEER', 'DANCER', 'EVENT_ORGANIZER', 'MANAGER'];

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Prototype "Discover" screen on real data. Filters live in the URL, so results are
 * shareable and survive a reload.
 */
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'work' ? 'work' : 'people';
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const roles = (params.get('roles')?.split(',').filter(Boolean) ?? []) as CreativeRole[];
  const genre = params.get('genre') ?? '';
  const type = params.get('type') ?? '';
  const location = params.get('location') ?? '';

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  useEffect(() => set('q', q || null), [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRole = (r: CreativeRole) => set('roles', (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]).join(',') || null);
  const hasFilters = Boolean(q || roles.length || genre || type || location);

  return (
    <div>
      <PageHeader eyebrow="Discover / creative network" title="Find your next creative spark." description="Search by name, skill, genre, location and the kind of talent you need." />

      <div role="tablist" aria-label="What to discover" className="mb-4 flex gap-1 border-b border-[#264b3d]">
        {(['people', 'work'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => set('view', v === 'people' ? null : 'work')} className={cn('min-h-11 border-b-2 px-4 text-xs font-bold', view === v ? 'border-[#26ed9f] text-[#76f5bc]' : 'border-transparent text-[#9ac2b0] hover:text-foreground')}>
            {v === 'people' ? 'People' : 'Creative work'}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 lg:flex-row">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[11px] border border-[#2b5e49] bg-[#102e25] px-3 text-[#a1c6b1]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input aria-label="Search" value={text} onChange={(e) => setText(e.target.value)} placeholder={view === 'people' ? 'Search by name, skill, city…' : 'Search titles, descriptions, credits…'} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-[#739988]" />
          {text && <button type="button" aria-label="Clear search" onClick={() => setText('')}><X className="size-4" /></button>}
        </label>
        <Select aria-label="Genre" value={genre} onChange={(e) => set('genre', e.target.value || null)} className="lg:w-44">
          <option value="">All genres</option>
          {GENRE_KEYS.map((g) => <option key={g} value={g}>{GENRES[g]}</option>)}
        </Select>
        {view === 'people' ? (
          <label className="flex h-11 items-center gap-2 rounded-[9px] border border-[#2b5844] bg-[#081d17] px-3 lg:w-44">
            <MapPin className="size-4 shrink-0 text-sage-dim" aria-hidden />
            <input aria-label="Location" defaultValue={location} onBlur={(e) => set('location', e.target.value.trim() || null)} onKeyDown={(e) => e.key === 'Enter' && set('location', e.currentTarget.value.trim() || null)} placeholder="Location" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#62836e]" />
          </label>
        ) : (
          <Select aria-label="Type of work" value={type} onChange={(e) => set('type', e.target.value || null)} className="lg:w-48">
            <option value="">All types</option>
            {PORTFOLIO_TYPE_KEYS.map((t) => <option key={t} value={t}>{PORTFOLIO_TYPES[t].label}</option>)}
          </Select>
        )}
      </div>

      {view === 'people' && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by role">
          {QUICK_ROLES.map((r) => (
            <button key={r} type="button" aria-pressed={roles.includes(r)} onClick={() => toggleRole(r)} className={cn('min-h-10 shrink-0 rounded-[9px] border px-3 text-xs', roles.includes(r) ? 'border-[#33eba5] bg-[#34e6a5] font-bold text-[#062819]' : 'border-[#2a5744] bg-[#0e2c22] text-[#a8cdbb]')}>
              {CREATIVE_ROLES[r]}
            </button>
          ))}
        </div>
      )}
      {hasFilters && (
        <Button variant="link" size="sm" className="mb-3 -ml-1.5" onClick={() => { setText(''); setParams(view === 'work' ? { view: 'work' } : {}, { replace: true }); }}>
          Clear all filters
        </Button>
      )}

      {view === 'people' ? (
        <PeopleResults q={q} roles={roles} genres={genre ? [genre] : []} location={location} />
      ) : (
        <WorkResults q={q} types={type ? [type] : []} genres={genre ? [genre] : []} />
      )}
    </div>
  );
}

function PeopleResults(filters: { q: string; roles: string[]; genres: string[]; location: string }) {
  const query = useInfiniteQuery({
    queryKey: socialKeys.discoverPeople(filters),
    queryFn: ({ pageParam }) => api.discoverPeople({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev, // keep showing old results while new ones load
  });
  const people = flatten(query.data);
  if (query.isPending) return <PageLoading />;
  if (query.isError && people.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (people.length === 0) {
    return <Panel className="p-8 text-center"><h2 className="font-bold">No one matches yet</h2><p className="mt-1 text-sm text-sage">Try fewer filters or a different search. MuzikHub is growing — new people join every day.</p></Panel>;
  }
  return (
    <InfiniteList hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} isError={query.isError}>
      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', query.isFetching && !query.isFetchingNextPage && 'opacity-60')}>
        {people.map((p) => <PersonCard key={p.username} person={p} />)}
      </div>
    </InfiniteList>
  );
}

/** Prototype `.personcard`. */
function PersonCard({ person }: { person: PersonCardData }) {
  const roles = person.roles.slice(0, 2).map((r) => CREATIVE_ROLES[r]).join(' · ');
  return (
    <Link to={`/u/${person.username}`} className="block overflow-hidden rounded-[15px] border border-[#255441] bg-[#0d2a21] transition hover:border-[#3a7f60]">
      <div className="relative h-20 sm:h-24">
        {person.cover ? (
          <ResponsiveImage media={person.cover} alt="" aspect="auto" className="h-full" sizes="(min-width: 1024px) 25vw, 50vw" />
        ) : (
          <div className="h-full bg-[radial-gradient(ellipse_at_80%_0%,#1b6b4a_0%,transparent_60%),#0b241b]" />
        )}
        <Avatar name={person.name} image={person.image} className="absolute -bottom-6 left-3 size-14 border-[3px] border-[#0d2a21] text-sm" />
      </div>
      <div className="p-3 pt-8">
        <strong className="block truncate text-sm">{person.name}</strong>
        <p className="truncate text-[11px] text-[#95bdaa]">{roles || '@' + person.username}</p>
        {person.location && <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-sage-dim"><MapPin className="size-3 shrink-0" aria-hidden />{person.location}</p>}
        <div className="mt-2.5 flex flex-wrap gap-1">
          {person.following && <Pill variant="gray" className="px-2 py-0.5 text-[10px]">Following</Pill>}
          {person.publishedWorkCount > 0 && <Pill className="px-2 py-0.5 text-[10px]">{person.publishedWorkCount} {person.publishedWorkCount === 1 ? 'work' : 'works'}</Pill>}
        </div>
      </div>
    </Link>
  );
}

function WorkResults(filters: { q: string; types: string[]; genres: string[] }) {
  const query = useInfiniteQuery({
    queryKey: socialKeys.discoverWork(filters),
    queryFn: ({ pageParam }) => api.discoverWork({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
  const items = flatten(query.data);
  if (query.isPending) return <PageLoading />;
  if (query.isError && items.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (items.length === 0) {
    return <Panel className="p-8 text-center"><h2 className="font-bold">No published work matches</h2><p className="mt-1 text-sm text-sage">Try another genre or type — or <Link to="/studio/new" className="text-mint-soft hover:underline">share your own</Link>.</p></Panel>;
  }
  return (
    <InfiniteList hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} isError={query.isError}>
      <PortfolioGrid>{items.map((i) => <PortfolioCard key={i.id} item={i} showOwner />)}</PortfolioGrid>
    </InfiniteList>
  );
}
