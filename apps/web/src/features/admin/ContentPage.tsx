import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { flatten } from '@/lib/social-queries';
import { adminApi, type ContentRow } from './admin-api';
import { AdminHeader, Ago, DataTable, EmptyRow, FilterTabs, ReasonDialog, Tag, useAdminAction } from './ui';

type Kind = 'post' | 'comment' | 'portfolio-item' | 'community' | 'competition';
const KINDS: Kind[] = ['post', 'comment', 'portfolio-item', 'community', 'competition'];

/** Oversight of public user content: find it, remove it with a reason, restore it. */
export function ContentPage() {
  const [params, setParams] = useSearchParams();
  const type = ((KINDS as string[]).includes(params.get('type') ?? '') ? params.get('type') : 'post') as Kind;
  const state = params.get('state') === 'removed' ? 'removed' : 'visible';
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<ContentRow | null>(null);
  const act = useAdminAction();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'content', type, state, q],
    queryFn: ({ pageParam }) => adminApi.content({ type, state, q: q.trim() || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
  const rows = flatten(query.data);
  const setParam = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set(k, v);
        return n;
      },
      { replace: true },
    );

  return (
    <div>
      <AdminHeader
        title="Content"
        description="Publicly visible member content. Removal hides it everywhere but keeps it for the record; it can be restored."
      />
      <FilterTabs
        label="Content type"
        value={type}
        onChange={(v) => setParam('type', v)}
        options={[
          { value: 'post', label: 'Feed posts' },
          { value: 'portfolio-item', label: 'Portfolio' },
          { value: 'comment', label: 'Comments' },
          { value: 'community', label: 'Communities' },
          { value: 'competition', label: 'Competitions' },
        ]}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search content"
          placeholder="Search text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:max-w-sm"
        />
        <FilterTabs
          label="State"
          value={state}
          onChange={(v) => setParam('state', v)}
          options={[
            { value: 'visible', label: 'Visible' },
            { value: 'removed', label: 'Removed' },
          ]}
        />
      </div>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <InfiniteList
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
          isError={query.isError}
        >
          <DataTable label="Content">
            <thead>
              <tr>
                <th>Content</th>
                <th>Author</th>
                <th>Posted</th>
                <th>Reports</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={5}>{state === 'removed' ? 'Nothing has been removed.' : 'No content found.'}</EmptyRow>
              ) : (
                rows.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-85">
                      <div className="flex gap-2.5">
                        {c.thumbnail && (
                          <img src={c.thumbnail} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
                        )}
                        <div className="min-w-0">
                          {c.title && <p className="font-semibold">{c.title}</p>}
                          <p className="line-clamp-2 text-text-2">{c.excerpt ?? (c.thumbnail ? 'Media post' : '—')}</p>
                          {c.removedAt && (
                            <p className="mt-0.5 text-xs text-danger">
                              Removed <Ago iso={c.removedAt} />: {c.removalReason}
                            </p>
                          )}
                          <a
                            href={c.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
                          >
                            Open <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Link to={`/admin/users?q=${encodeURIComponent(c.author.username)}`} className="hover:text-signal">
                        {c.author.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-text-2">
                      <Ago iso={c.createdAt} />
                    </td>
                    <td>{c.openReports > 0 ? <Tag color="gold">{c.openReports} open</Tag> : <span className="text-text-3">—</span>}</td>
                    <td className="text-right">
                      <Button size="sm" variant={c.removedAt ? 'outline' : 'destructive'} onClick={() => setTarget(c)}>
                        {c.removedAt ? 'Restore' : 'Remove'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </InfiniteList>
      )}
      <ReasonDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.removedAt ? 'Restore content' : 'Remove content'}
        confirmLabel={target?.removedAt ? 'Restore' : 'Remove'}
        destructive={!target?.removedAt}
        onConfirm={(reason) =>
          target!.removedAt
            ? act(() => adminApi.restoreContent(target!.kind, target!.id, reason), 'Content restored')
            : act(() => adminApi.removeContent(target!.kind, target!.id, reason), 'Content removed')
        }
      />
    </div>
  );
}
