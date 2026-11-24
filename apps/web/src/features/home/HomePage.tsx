import { Link, useSearchParams } from 'react-router';
import { cn } from '@/lib/cn';
import { ArrowRight, Search } from 'lucide-react';
import { CREATIVE_ROLES, type FeedTab, type Me } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, Eyebrow, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { Composer } from '@/features/feed/Composer';
import { PostCard } from '@/features/feed/PostCard';
import { SocialLinks } from '@/features/profile/SocialLinks';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { flatten, useFeed } from '@/lib/social-queries';

/** Signed-in home = the main creative feed (CLAUDE.md §8). */
export function HomePage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tab: FeedTab = params.get('tab') === 'following' ? 'following' : 'discover';
  if (!me) return <PageLoading />;
  const firstName = me.profile.name.split(/\s+/)[0] ?? me.profile.name;

  return (
    <div>
      <Hero firstName={firstName} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Composer />
          <div role="tablist" aria-label="Feed" className="flex gap-1 border-b border-[#264b3d]">
            {(['discover', 'following'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setParams(t === 'discover' ? {} : { tab: t }, { replace: true })}
                className={cn(
                  'min-h-11 border-b-2 px-4 text-xs font-bold',
                  tab === t ? 'border-[#26ed9f] text-[#76f5bc]' : 'border-transparent text-[#9ac2b0] hover:text-foreground',
                )}
              >
                {t === 'discover' ? 'Discover' : 'Following'}
              </button>
            ))}
          </div>
          <Feed tab={tab} />
        </div>
        <aside className="space-y-4">
          {me.profile.onboardingCompletedAt ? <ProfileCard me={me} /> : <FinishSetupCard me={me} />}
          <Panel className="p-5">
            <h2 className="font-bold">Find your people</h2>
            <p className="mt-1 mb-4 text-sm text-sage">Search artists, producers, DJs and engineers by role, genre and location.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/discover">
                <Search /> Discover talent
              </Link>
            </Button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Feed({ tab }: { tab: FeedTab }) {
  const query = useFeed(tab);
  const posts = flatten(query.data);

  if (query.isPending) return <PageLoading />;
  if (query.isError && posts.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (posts.length === 0) {
    return (
      <Panel className="p-8 text-center">
        {tab === 'following' ? (
          <>
            <h2 className="text-lg font-bold">Your following feed is quiet</h2>
            <p className="mx-auto mt-1 mb-5 max-w-sm text-sm text-sage">
              Follow artists and professionals to see their work and updates here.
            </p>
            <Button asChild>
              <Link to="/discover">Find people to follow</Link>
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold">No posts yet</h2>
            <p className="mx-auto mt-1 mb-5 max-w-sm text-sm text-sage">
              Be the first to share something — a clip, a beat, or what you're working on.
            </p>
            <Button asChild>
              <Link to="/studio/new">Add work to your portfolio</Link>
            </Button>
          </>
        )}
      </Panel>
    );
  }
  return (
    <InfiniteList
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      fetchNextPage={() => void query.fetchNextPage()}
      isError={query.isError}
    >
      <div className="space-y-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </InfiniteList>
  );
}

/** Prototype `.hero`, compact. Desktop only so the feed comes first on phones. */
function Hero({ firstName }: { firstName: string }) {
  return (
    <section className="relative mb-5 hidden min-h-[170px] items-center overflow-hidden rounded-[23px] border border-[#2c7055] bg-[radial-gradient(ellipse_at_85%_10%,#1b6b4a_0%,transparent_50%),linear-gradient(90deg,#061d15,#071c17)] md:flex">
      <div className="relative z-10 px-10 py-7">
        <Eyebrow>Welcome back, {firstName}</Eyebrow>
        <h1 className="mt-3 text-[34px] leading-[1.065] font-extrabold tracking-[-0.045em]">
          Discover talent. Create together. <em className="text-[#41eca5] not-italic">Grow together.</em>
        </h1>
      </div>
      <span aria-hidden className="absolute right-0 bottom-0 h-0.5 w-2/5 bg-[linear-gradient(90deg,transparent,#4cf7ae,transparent)]" />
    </section>
  );
}

function FinishSetupCard({ me }: { me: Me }) {
  const total = me.profile.primaryUse === 'FAN' ? 2 : 4;
  const done = Math.min(me.profile.onboardingStep, total);
  return (
    <Panel className="p-5">
      <Eyebrow>
        Profile setup · {done} of {total} steps
      </Eyebrow>
      <h2 className="mt-2 text-lg font-bold">Finish setting up your profile</h2>
      <p className="mt-1 mb-4 text-sm text-sage">Your progress is saved. Pick up where you left off.</p>
      <div className="mb-5 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? 'bg-emerald' : 'bg-forest-700'}`} />
        ))}
      </div>
      <Button asChild size="sm">
        <Link to="/onboarding">
          Continue setup <ArrowRight />
        </Link>
      </Button>
    </Panel>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const roles = me.profile.roles.map((r) => CREATIVE_ROLES[r]).join(' · ');
  const { stats } = me.profile;
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-3">
        <Avatar name={me.profile.name} image={me.profile.image} className="size-14 text-base" />
        <div className="min-w-0">
          <p className="truncate font-bold">{me.profile.name}</p>
          <p className="truncate text-xs text-sage">
            @{me.profile.username}
            {roles && ` · ${roles}`}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Followers', stats.followers],
          ['Connections', stats.connections],
          ['Works', stats.publishedWork],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg bg-[#0b241b] py-2">
            <dd className="text-base font-bold">{n}</dd>
            <dt className="text-[10px] text-sage">{label}</dt>
          </div>
        ))}
      </dl>
      <SocialLinks links={me.profile.links} className="mt-4" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={`/u/${me.profile.username}`}>View profile</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/network">Network</Link>
        </Button>
      </div>
    </Panel>
  );
}
