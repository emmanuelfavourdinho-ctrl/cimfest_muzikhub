import { useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { flatten, useMyPortfolio } from '@/lib/social-queries';
import { PortfolioCard, PortfolioGrid } from './PortfolioCard';

const tabs = [
  { key: undefined, label: 'All' },
  { key: 'DRAFT', label: 'Drafts' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'ARCHIVED', label: 'Archived' },
] as const;

/** Prototype "Creator studio": manage your own portfolio across statuses. */
export function StudioPage() {
  const [status, setStatus] = useState<(typeof tabs)[number]['key']>(undefined);
  const query = useMyPortfolio(status);
  const items = flatten(query.data);

  return (
    <div>
      <PageHeader
        eyebrow="Creator studio"
        title="Your portfolio"
        description="Showcase your music and creative work. Drafts and archived work are only visible to you."
        actions={
          <Button asChild>
            <Link to="/studio/new">
              <Plus /> Add work
            </Link>
          </Button>
        }
      />
      <div role="tablist" aria-label="Filter by status" className="mb-5 flex gap-1 overflow-x-auto border-b border-[#264b3d]">
        {tabs.map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={status === t.key}
            onClick={() => setStatus(t.key)}
            className={cn(
              'min-h-11 border-b-2 px-4 text-xs font-bold whitespace-nowrap',
              status === t.key ? 'border-[#26ed9f] text-[#76f5bc]' : 'border-transparent text-[#9ac2b0] hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <PageLoading />
      ) : query.isError && items.length === 0 ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Panel className="p-8 text-center">
          <h2 className="text-lg font-bold">{status ? 'Nothing here yet' : 'Start your portfolio'}</h2>
          <p className="mx-auto mt-1 mb-5 max-w-sm text-sm text-sage">
            Upload a track, a beat, a performance video or artwork — or add a project with links to where it lives.
          </p>
          <Button asChild>
            <Link to="/studio/new">
              <Plus /> Add your first work
            </Link>
          </Button>
        </Panel>
      ) : (
        <InfiniteList
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
          isError={query.isError}
        >
          <PortfolioGrid>
            {items.map((item) => (
              <PortfolioCard key={item.id} item={item} showStatus />
            ))}
          </PortfolioGrid>
        </InfiniteList>
      )}
    </div>
  );
}
