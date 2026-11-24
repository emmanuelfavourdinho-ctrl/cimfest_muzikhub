import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { toast } from 'sonner';
import type { ConnectionView, PersonSummary } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { timeAgo } from '@/features/feed/PostCard';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { flatten, socialKeys } from '@/lib/social-queries';

const tabs = [
  { key: 'incoming', label: 'Requests' },
  { key: 'outgoing', label: 'Sent' },
  { key: 'accepted', label: 'Connections' },
  { key: 'followers', label: 'Followers' },
  { key: 'following', label: 'Following' },
] as const;
type TabKey = (typeof tabs)[number]['key'];

export function NetworkPage() {
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? 'incoming') as TabKey;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Your network" title="Connections & followers" description="Respond to requests and keep track of the people you work with." />
      <div role="tablist" aria-label="Network" className="mb-5 flex gap-1 overflow-x-auto border-b border-[#264b3d]">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams({ tab: t.key }, { replace: true })} className={cn('min-h-11 border-b-2 px-4 text-xs font-bold whitespace-nowrap', tab === t.key ? 'border-[#26ed9f] text-[#76f5bc]' : 'border-transparent text-[#9ac2b0] hover:text-foreground')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'followers' || tab === 'following' ? <FollowList which={tab} /> : <ConnectionList filter={tab} />}
    </div>
  );
}

function ConnectionList({ filter }: { filter: 'incoming' | 'outgoing' | 'accepted' }) {
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: socialKeys.connections(filter),
    queryFn: ({ pageParam }) => api.connections(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = flatten(query.data);

  async function act(c: ConnectionView, action: 'accept' | 'decline' | 'cancel' | 'remove', done: string) {
    try {
      await api.connectionAction(c.id, action);
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['connections'] }),
      qc.invalidateQueries({ queryKey: ['me'] }),
      qc.invalidateQueries({ queryKey: socialKeys.relationship(c.person.username) }),
    ]);
  }

  if (query.isPending) return <PageLoading />;
  if (query.isError && items.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (items.length === 0) {
    const text = { incoming: 'No pending requests.', outgoing: "You haven't sent any requests that are waiting.", accepted: 'No connections yet.' }[filter];
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-sage">{text}</p>
        <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/discover">Discover people</Link></Button>
      </Panel>
    );
  }
  return (
    <InfiniteList hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} isError={query.isError}>
      <ul className="space-y-2.5">
        {items.map((c) => (
          <li key={c.id}>
            <Panel className="flex flex-wrap items-center gap-3 p-4">
              <PersonLink person={c.person} />
              {c.message && filter !== 'accepted' && <p className="w-full text-[13px] text-[#b5d4c2] sm:order-last">“{c.message}”</p>}
              <div className="ml-auto flex gap-2">
                {filter === 'incoming' && (
                  <>
                    <Button size="sm" onClick={() => void act(c, 'accept', `Connected with ${c.person.name}`)}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => void act(c, 'decline', 'Declined')}>Decline</Button>
                  </>
                )}
                {filter === 'outgoing' && <Button size="sm" variant="outline" onClick={() => void act(c, 'cancel', 'Request withdrawn')}>Withdraw</Button>}
                {filter === 'accepted' && <Button size="sm" variant="quiet" onClick={() => { if (confirm(`Remove ${c.person.name} from your connections?`)) void act(c, 'remove', 'Connection removed'); }}>Remove</Button>}
              </div>
              <p className="w-full text-[11px] text-sage-dim">{filter === 'accepted' && c.respondedAt ? `Connected ${timeAgo(c.respondedAt)}` : `Sent ${timeAgo(c.createdAt)}`}</p>
            </Panel>
          </li>
        ))}
      </ul>
    </InfiniteList>
  );
}

function FollowList({ which }: { which: 'followers' | 'following' }) {
  const { data: me } = useMe();
  const username = me?.profile.username ?? '';
  const query = useInfiniteQuery({
    queryKey: socialKeys.follows(username, which),
    queryFn: ({ pageParam }) => api.follows(username, which, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(username),
  });
  const people = flatten(query.data);
  if (query.isPending) return <PageLoading />;
  if (query.isError && people.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (people.length === 0) {
    return <Panel className="p-8 text-center text-sm text-sage">{which === 'followers' ? 'Nobody follows you yet.' : "You aren't following anyone yet."}</Panel>;
  }
  return (
    <InfiniteList hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} isError={query.isError}>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.username}><Panel className="p-4"><PersonLink person={p} /></Panel></li>
        ))}
      </ul>
    </InfiniteList>
  );
}

export function PersonLink({ person }: { person: PersonSummary }) {
  return (
    <Link to={`/u/${person.username}`} className="flex min-w-0 items-center gap-3 hover:text-mint">
      <Avatar name={person.name} image={person.image} className="size-11 shrink-0 text-xs" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{person.name}</span>
        <span className="block truncate text-xs text-sage">@{person.username}</span>
      </span>
    </Link>
  );
}
