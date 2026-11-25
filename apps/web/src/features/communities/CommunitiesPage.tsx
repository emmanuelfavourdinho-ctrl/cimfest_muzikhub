import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { COMMUNITY_CATEGORIES, COMMUNITY_CATEGORY_KEYS } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { EmptyState, PageHeader, PageLoading, Panel, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { communitiesApi, communityKeys } from '@/lib/communities';
import { useMe } from '@/lib/queries';
import { flatten } from '@/lib/social-queries';
import { CommunityRow, DiscussionRow } from './ui';

/** /communities — your communities and their latest discussions, then discovery of everything else. */
export function CommunitiesPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const [draft, setDraft] = useState(q);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const mine = useQuery({ queryKey: communityKeys.mine, queryFn: communitiesApi.mine, enabled: Boolean(me) });
  const featured = useQuery({ queryKey: communityKeys.featured, queryFn: communitiesApi.featured });
  const list = useInfiniteQuery({
    queryKey: communityKeys.list({ q, category }),
    queryFn: ({ pageParam }) => communitiesApi.list({ q: q || undefined, category: category || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(list.data);
  const filtering = Boolean(q || category);

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Communities"
        title="Learn, share and grow together"
        description="Ongoing conversations about the craft and the business of music, with people who’ve been there."
        actions={
          me ? (
            <Button asChild>
              <Link to="/communities/new">
                <Plus /> Start a community
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <section aria-labelledby="browse" className="min-w-0">
          <h2 id="browse" className="sr-only">
            Browse communities
          </h2>
          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              set('q', draft.trim() || null);
            }}
          >
            <Input
              aria-label="Search communities"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search by name or topic"
            />
            <Button type="submit" variant="outline" aria-label="Search">
              <Search />
            </Button>
          </form>
          <div role="group" aria-label="Category" className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <ToggleChip selected={!category} onClick={() => set('category', null)} className="shrink-0">
              All
            </ToggleChip>
            {COMMUNITY_CATEGORY_KEYS.map((k) => (
              <ToggleChip key={k} selected={category === k} onClick={() => set('category', category === k ? null : k)} className="shrink-0">
                {COMMUNITY_CATEGORIES[k]}
              </ToggleChip>
            ))}
          </div>

          {!filtering && (featured.data?.items.length ?? 0) > 0 && (
            <div className="mt-5">
              <h3 className="text-small font-semibold text-text-2">Featured by the MuzikHub team</h3>
              <ul className="mt-1">
                {featured.data!.items.map((c) => (
                  <CommunityRow key={c.id} c={c} />
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-small font-semibold text-text-2">{filtering ? 'Results' : 'All communities'}</h3>
            {list.isPending ? (
              <PageLoading />
            ) : list.isError && rows.length === 0 ? (
              <LoadFailed message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={filtering ? 'No communities match' : 'No communities yet'}
                action={
                  me ? (
                    <Button asChild variant="outline">
                      <Link to="/communities/new">Start the first one</Link>
                    </Button>
                  ) : undefined
                }
              >
                {filtering ? 'Try another word or category.' : 'Start one around your craft, your genre or your city.'}
              </EmptyState>
            ) : (
              <InfiniteList
                hasNextPage={list.hasNextPage}
                isFetchingNextPage={list.isFetchingNextPage}
                fetchNextPage={() => void list.fetchNextPage()}
                isError={list.isError}
              >
                <ul>
                  {rows.map((c) => (
                    <CommunityRow key={c.id} c={c} />
                  ))}
                </ul>
              </InfiniteList>
            )}
          </div>
        </section>

        {me && (
          <aside aria-labelledby="yours" className="space-y-4">
            <Panel className="p-4">
              <h2 id="yours" className="text-small font-semibold text-text-1">
                Your communities
              </h2>
              {mine.isPending ? (
                <PageLoading />
              ) : (mine.data?.items.length ?? 0) === 0 ? (
                <p className="mt-2 text-small text-text-2">You haven’t joined any yet. Open one from the list to read along or join.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {mine.data!.items.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/communities/${c.slug}`}
                        className="flex min-h-10 items-center justify-between gap-2 rounded-s px-2 text-small hover:bg-surface-overlay"
                      >
                        <span className="truncate">{c.name}</span>
                        {c.membership?.status !== 'ACTIVE' && (
                          <span className="text-caption text-text-3">{c.membership?.status === 'INVITED' ? 'Invited' : 'Requested'}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {(mine.data?.recent.length ?? 0) > 0 && (
              <Panel className="p-4">
                <h2 className="text-small font-semibold text-text-1">Latest in your communities</h2>
                <ul className="mt-1">
                  {mine.data!.recent.map((d) => (
                    <DiscussionRow key={d.id} d={d} showCommunity />
                  ))}
                </ul>
              </Panel>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
