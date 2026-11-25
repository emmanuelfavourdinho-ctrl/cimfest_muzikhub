import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { COMPETITION_CATEGORIES, COMPETITION_CATEGORY_KEYS } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { compApi, compKeys } from '@/lib/competitions';
import { useMe } from '@/lib/queries';
import { CompetitionRow } from './ui';

const TABS = [
  { key: 'OPEN', label: 'Open now' },
  { key: 'UPCOMING', label: 'Opening soon' },
  { key: 'JUDGING', label: 'Being judged' },
  { key: 'RESULTS', label: 'Results' },
  { key: 'mine', label: 'Mine' },
] as const;

/** /competitions — real competitions from approved organisers, by phase. */
export function CompetitionsPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'OPEN';
  const category = params.get('category') ?? '';
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const organiser = useQuery({ queryKey: ['opportunities', 'organiser-status'], queryFn: api.organiserStatus, enabled: Boolean(me) });
  const mine = tab === 'mine';
  const list = useQuery({
    queryKey: compKeys.list({ tab, category, q }),
    queryFn: () => compApi.list(mine ? { mine: 'organising' } : { phase: tab, category: category || undefined, q: q || undefined }),
  });
  const entered = useQuery({
    queryKey: compKeys.list({ mine: 'entered' }),
    queryFn: () => compApi.list({ mine: 'entered' }),
    enabled: mine && Boolean(me),
  });
  const judging = useQuery({
    queryKey: compKeys.list({ mine: 'judging' }),
    queryFn: () => compApi.list({ mine: 'judging' }),
    enabled: mine && Boolean(me),
  });

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Competitions"
        title="Challenges with real stakes"
        description="Clear rules, published judging criteria and transparent results. Prizes are offered by each organiser, not by MuzikHub."
        actions={
          organiser.data?.canOrganise ? (
            <Button asChild>
              <Link to="/competitions/new">
                <Plus /> Run a competition
              </Link>
            </Button>
          ) : null
        }
      />
      <div role="tablist" aria-label="Competitions" className="mb-4 flex gap-1 overflow-x-auto border-b border-hairline-strong">
        {TABS.filter((t) => t.key !== 'mine' || me).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => set('tab', t.key === 'OPEN' ? null : t.key)}
            className={cn(
              'min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold',
              tab === t.key ? 'border-signal text-signal' : 'border-transparent text-text-2 hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!mine && (
        <>
          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              set('q', draft.trim() || null);
            }}
          >
            <Input
              aria-label="Search competitions"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search competitions"
            />
            <Button type="submit" variant="outline" aria-label="Search">
              <Search />
            </Button>
          </form>
          <div role="group" aria-label="Category" className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <ToggleChip selected={!category} onClick={() => set('category', null)} className="shrink-0">
              All
            </ToggleChip>
            {COMPETITION_CATEGORY_KEYS.map((k) => (
              <ToggleChip key={k} selected={category === k} onClick={() => set('category', category === k ? null : k)} className="shrink-0">
                {COMPETITION_CATEGORIES[k]}
              </ToggleChip>
            ))}
          </div>
        </>
      )}
      <div className="mt-2">
        {list.isPending ? (
          <PageLoading />
        ) : list.isError ? (
          <LoadFailed message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : mine ? (
          <div className="space-y-6">
            <Section title="You organise" items={list.data.items} empty="You don’t organise any competitions." />
            <Section title="You entered" items={entered.data?.items ?? []} empty="You haven’t entered any yet." />
            <Section title="You judge" items={judging.data?.items ?? []} empty="You aren’t judging any." />
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Nothing here right now">
            {q || category ? 'Try another search or category.' : 'Check the other tabs, or come back soon.'}
          </EmptyState>
        ) : (
          <ul>
            {list.data.items.map((c) => (
              <CompetitionRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, empty }: { title: string; items: Parameters<typeof CompetitionRow>[0]['c'][]; empty: string }) {
  return (
    <section aria-label={title}>
      <h2 className="text-small font-semibold text-text-2">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-small text-text-3">{empty}</p>
      ) : (
        <ul>
          {items.map((c) => (
            <CompetitionRow key={c.id} c={c} />
          ))}
        </ul>
      )}
    </section>
  );
}
