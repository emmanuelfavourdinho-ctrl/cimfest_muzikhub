import { Link, useParams, useSearchParams } from 'react-router';
import { cn } from '@/lib/cn';
import { Check, MapPin, Pencil, Plus } from 'lucide-react';
import { CAREER_STAGES, CREATIVE_ROLES, GENRES, PRIMARY_USES, type PublicProfile } from '@muzikhub/shared';
import { ResponsiveImage } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { ACCENT_BAR, ACCENT_RING } from '@/features/billing/ui';
import { Avatar, Eyebrow, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { PostCard } from '@/features/feed/PostCard';
import { ReportButton } from '@/features/feed/ReportButton';
import { RelationshipActions } from '@/features/network/RelationshipActions';
import { PortfolioCard, PortfolioGrid } from '@/features/portfolio/PortfolioCard';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useMe, usePublicProfile } from '@/lib/queries';
import { flatten, useProfilePortfolio, useProfilePosts } from '@/lib/social-queries';
import { SocialLinks } from './SocialLinks';

export function ProfilePage() {
  const { username = '' } = useParams();
  const { data: profile, isPending, isError, error, refetch } = usePublicProfile(username);
  const { data: me } = useMe();

  if (isPending) return <PageLoading />;
  if (isError) {
    if (error instanceof ApiRequestError && error.status === 404) return <ProfileNotFound username={username} />;
    return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  }
  return <ProfileView profile={profile} isOwner={me?.profile.username === profile.username} signedIn={Boolean(me)} />;
}

const TABS = ['portfolio', 'posts', 'about'] as const;
type Tab = (typeof TABS)[number];

function ProfileView({ profile, isOwner, signedIn }: { profile: PublicProfile; isOwner: boolean; signedIn: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'portfolio';
  const roleLabels = profile.roles.map((r) => CREATIVE_ROLES[r]);
  const headline = roleLabels.length > 0 ? roleLabels.join(' · ') : profile.primaryUse ? PRIMARY_USES[profile.primaryUse].label : null;

  return (
    <article>
      {/* Prototype `.profile-banner`: the user's own cover, or the brand gradient. */}
      <div className="relative h-38 overflow-hidden rounded-panel border border-control-border sm:h-47.5">
        {profile.cover ? (
          <>
            <ResponsiveImage
              media={profile.cover}
              alt=""
              priority
              aspect="auto"
              className="h-full"
              sizes="(min-width: 1024px) 1200px, 100vw"
            />
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#092018cc_0%,#09201840_50%,transparent_100%)]" />
          </>
        ) : (
          <div className="h-full bg-[radial-gradient(ellipse_at_80%_0%,var(--p-glow)_0%,transparent_55%),linear-gradient(135deg,var(--p-overlay),var(--p-raised))]" />
        )}
        {profile.accent ? (
          // Paid accent (Creator Plus / Pro): the owner's chosen palette colour.
          <span aria-hidden data-accent={profile.accent} className={cn('absolute bottom-0 h-1.5 w-full', ACCENT_BAR[profile.accent])} />
        ) : (
          <span aria-hidden className="absolute bottom-0 h-1 w-44 bg-[linear-gradient(90deg,var(--p-accent),transparent)]" />
        )}
      </div>

      <div className="relative -mt-9 flex flex-col gap-3 px-3 sm:-mt-12 sm:flex-row sm:items-end sm:gap-5 sm:px-7">
        <Avatar
          name={profile.name}
          image={profile.image}
          className={cn(
            'size-21 border-5 border-hairline-strong text-2xl ring-2 sm:size-26.25 sm:text-3xl',
            profile.accent ? ACCENT_RING[profile.accent] : 'ring-control-border',
          )}
        />
        <div className="min-w-0 flex-1 sm:pb-1">
          <Eyebrow>{profile.primaryUse === 'FAN' ? 'Member profile' : 'Creator profile'}</Eyebrow>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.05em] break-words sm:text-3xl">{profile.name}</h1>
          <p className="mt-0.5 text-xs text-text-2">
            @{profile.username}
            {headline && <> · {headline}</>}
            {profile.location && (
              <>
                {' '}
                · <MapPin className="inline size-3 -translate-y-px" aria-hidden /> {profile.location}
              </>
            )}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
            <span>
              <strong className="text-foreground">{profile.stats.followers}</strong> followers
            </span>
            <span>
              <strong className="text-foreground">{profile.stats.following}</strong> following
            </span>
            <span>
              <strong className="text-foreground">{profile.stats.connections}</strong> connections
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:pb-1">
          {isOwner ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/profile">
                  <Pencil /> Edit profile
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/promote?product=PROFILE_SPOTLIGHT">Spotlight my profile</Link>
              </Button>
            </>
          ) : (
            <>
              <RelationshipActions username={profile.username} name={profile.name} />
              {signedIn && <ReportButton targetType="PROFILE" targetId={profile.username} compact />}
            </>
          )}
        </div>
      </div>

      <SocialLinks links={profile.links} className="mt-5 px-3 sm:px-7" trackClicks />

      <div role="tablist" aria-label="Profile sections" className="mt-5 flex gap-1 overflow-x-auto border-b border-hairline-strong">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === 'portfolio' ? {} : { tab: t }, { replace: true })}
            className={cn(
              'min-h-11 border-b-2 px-4 text-xs font-bold capitalize',
              tab === t ? 'border-signal text-signal' : 'border-transparent text-text-2 hover:text-foreground',
            )}
          >
            {t === 'portfolio' ? `Portfolio${profile.stats.publishedWork ? ` (${profile.stats.publishedWork})` : ''}` : t}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'portfolio' && <PortfolioTab profile={profile} isOwner={isOwner} />}
        {tab === 'posts' && <PostsTab username={profile.username} isOwner={isOwner} />}
        {tab === 'about' && <AboutTab profile={profile} isOwner={isOwner} roleLabels={roleLabels} />}
      </div>
    </article>
  );
}

function PortfolioTab({ profile, isOwner }: { profile: PublicProfile; isOwner: boolean }) {
  const query = useProfilePortfolio(profile.username);
  const items = flatten(query.data);
  if (query.isPending) return <PageLoading />;
  if (query.isError && items.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (items.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-text-2">
          {isOwner ? "You haven't published any work yet." : `${profile.name} hasn't published any work yet.`}
        </p>
        {isOwner && (
          <Button asChild size="sm" className="mt-4">
            <Link to="/studio/new">
              <Plus /> Add work
            </Link>
          </Button>
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
      <PortfolioGrid>
        {items.map((i) => (
          <PortfolioCard key={i.id} item={i} />
        ))}
      </PortfolioGrid>
    </InfiniteList>
  );
}

function PostsTab({ username, isOwner }: { username: string; isOwner: boolean }) {
  const query = useProfilePosts(username);
  const posts = flatten(query.data);
  if (query.isPending) return <PageLoading />;
  if (query.isError && posts.length === 0) return <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (posts.length === 0) {
    return (
      <Panel className="p-8 text-center text-sm text-text-2">
        {isOwner ? (
          <>
            No posts yet.{' '}
            <Link to="/home" className="text-signal hover:underline">
              Share something
            </Link>
            .
          </>
        ) : (
          'No posts yet.'
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
      <div className="mx-auto max-w-2xl space-y-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </InfiniteList>
  );
}

function AboutTab({ profile, isOwner, roleLabels }: { profile: PublicProfile; isOwner: boolean; roleLabels: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_0.75fr]">
      <Panel className="p-5">
        <h2 className="mb-3 text-lg font-bold">About</h2>
        {profile.bio ? (
          <p className="text-caption leading-[1.8] whitespace-pre-line text-text-2">{profile.bio}</p>
        ) : (
          <p className="text-sm text-text-2">{isOwner ? "You haven't written a bio yet." : `${profile.name} hasn't written a bio yet.`}</p>
        )}
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-1 text-lg font-bold">At a glance</h2>
        <dl>
          {roleLabels.length > 0 && <Glance label="Creative focus">{roleLabels.join(' · ')}</Glance>}
          {profile.genres.length > 0 && <Glance label="Genres">{profile.genres.map((g) => GENRES[g]).join(' · ')}</Glance>}
          {profile.skills.length > 0 && <Glance label="Skills">{profile.skills.join(' · ')}</Glance>}
          {profile.location && <Glance label="Location">{profile.location}</Glance>}
          {profile.careerStage && <Glance label="Career stage">{CAREER_STAGES[profile.careerStage]}</Glance>}
          <Glance label="Member since">
            {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Glance>
        </dl>
        {profile.roles.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.roles.map((r) => (
              <Pill key={r}>{CREATIVE_ROLES[r]}</Pill>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Glance({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-hairline-strong py-3 text-caption last:border-0">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
      <div>
        <dt className="text-xs text-text-2">{label}</dt>
        <dd className="font-semibold text-text-1">{children}</dd>
      </div>
    </div>
  );
}

function ProfileNotFound({ username }: { username: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Eyebrow className="justify-center">Profile not found</Eyebrow>
      <h1 className="mt-3 text-2xl font-bold [overflow-wrap:anywhere]">There's no one at @{username}</h1>
      <p className="mt-2 mb-6 text-sm text-text-2">The username may have changed, or the account is no longer active.</p>
      <Button asChild variant="outline">
        <Link to="/">Go to MuzikHub</Link>
      </Button>
    </div>
  );
}
