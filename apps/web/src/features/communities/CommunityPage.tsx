import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_POLICIES,
  createDiscussionSchema,
  DISCUSSION_KINDS,
  DISCUSSION_KIND_KEYS,
  GENRES,
  type CommunityDetail,
  type DiscussionKind,
  type Genre,
  type MemberView,
} from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, EmptyState, Eyebrow, PageLoading, Panel, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ReportButton } from '@/features/feed/ReportButton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { communitiesApi, communityKeys } from '@/lib/communities';
import { useMe } from '@/lib/queries';
import { flatten } from '@/lib/social-queries';
import { DiscussionRow, PolicyBadge, RoleBadge } from './ui';

const TABS = ['discussions', 'about', 'members'] as const;
type Tab = (typeof TABS)[number];

/** /communities/:slug — the community: its conversations first, then what it's about and who's in it. */
export function CommunityPage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: communityKeys.detail(slug), queryFn: () => communitiesApi.detail(slug) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Community c={q.data} />;
}

function Community({ c }: { c: CommunityDetail }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'discussions';
  return (
    <article className="mx-auto max-w-content">
      {c.cover && (
        <div className="mb-4 h-32 overflow-hidden rounded-panel border border-hairline-strong sm:h-44">
          <img src={c.cover} alt="" className="size-full object-cover" />
        </div>
      )}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Eyebrow>{COMMUNITY_CATEGORIES[c.category]}</Eyebrow>
          <h1 className="mt-1.5 text-2xl leading-tight font-bold tracking-tight break-words sm:text-3xl">{c.name}</h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-2">
            <PolicyBadge policy={c.policy} />
            <span>
              {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
            </span>
            <span>
              {c.discussionCount} {c.discussionCount === 1 ? 'discussion' : 'discussions'}
            </span>
          </p>
        </div>
        <MembershipActions c={c} />
      </header>
      <p className="mt-3 max-w-measure text-body text-text-2">{c.description}</p>

      <div role="tablist" aria-label="Community sections" className="mt-5 flex gap-1 overflow-x-auto border-b border-hairline-strong">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === 'discussions' ? {} : { tab: t }, { replace: true })}
            className={cn(
              'min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold capitalize',
              tab === t ? 'border-signal text-signal' : 'border-transparent text-text-2 hover:text-foreground',
            )}
          >
            {t}
            {t === 'members' && c.pendingRequests > 0 && (
              <span className="ml-1.5 rounded-full bg-signal px-1.5 text-xs text-on-signal">{c.pendingRequests}</span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'discussions' && <Discussions c={c} />}
        {tab === 'about' && <About c={c} />}
        {tab === 'members' && <Members c={c} />}
      </div>
    </article>
  );
}

function MembershipActions({ c }: { c: CommunityDetail }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [note, setNote] = useState('');
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: communityKeys.all });
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!me) {
    return (
      <Button asChild>
        <Link to={`/login?next=${encodeURIComponent(`/communities/${c.slug}`)}`}>Sign in to join</Link>
      </Button>
    );
  }
  const m = c.membership;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {m?.status === 'ACTIVE' ? (
        m.role !== 'OWNER' && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => communitiesApi.leave(c.slug), `You left ${c.name}`)}
          >
            Leave
          </Button>
        )
      ) : m?.status === 'PENDING' ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => communitiesApi.leave(c.slug), 'Request withdrawn')}
        >
          Requested · Withdraw
        </Button>
      ) : m?.status === 'INVITED' ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => void run(() => communitiesApi.acceptInvite(c.slug), `Welcome to ${c.name}`)}>
            Accept invitation
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => communitiesApi.declineInvite(c.slug), 'Invitation declined')}
          >
            Decline
          </Button>
        </>
      ) : m?.status === 'BANNED' ? (
        <p className="text-caption text-text-2">You can’t join this community.</p>
      ) : c.policy === 'OPEN' ? (
        <Button size="sm" disabled={busy} onClick={() => void run(() => communitiesApi.join(c.slug), `Welcome to ${c.name}`)}>
          Join
        </Button>
      ) : c.policy === 'REQUEST' ? (
        <Button size="sm" disabled={busy} onClick={() => setAskOpen(true)}>
          Request to join
        </Button>
      ) : (
        <p className="text-caption text-text-2">Invitation only</p>
      )}
      {c.permissions.editSettings && (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/communities/${c.slug}/settings`}>
            <Settings /> Settings
          </Link>
        </Button>
      )}
      {m?.role !== 'OWNER' && <ReportButton targetType="COMMUNITY" targetId={c.id} compact />}
      <Dialog open={askOpen} onClose={() => setAskOpen(false)} title={`Ask to join ${c.name}`}>
        <p className="mb-3 text-sm text-text-2">A moderator will review your request. Read the rules on the About tab first.</p>
        <Field label="A note for the moderators (optional)" hint={`${note.length}/300`}>
          {(a) => (
            <Textarea
              {...a}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you do and why you’d like to join"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setAskOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await communitiesApi.join(c.slug, note.trim() || undefined);
                setAskOpen(false);
              }, 'Request sent')
            }
          >
            Send request
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Discussions({ c }: { c: CommunityDetail }) {
  const [kind, setKind] = useState<DiscussionKind | null>(null);
  const [composing, setComposing] = useState(false);
  const q = useInfiniteQuery({
    queryKey: communityKeys.discussions(c.slug, kind ?? undefined),
    queryFn: ({ pageParam }) => communitiesApi.discussions(c.slug, kind ?? undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: c.canRead,
  });
  if (!c.canRead) {
    return (
      <EmptyState title="Discussions are for members">
        {c.policy === 'INVITE' ? 'This community is invitation only.' : 'Request to join and a moderator will let you in.'} You can read
        what it’s about and its rules on the About tab.
      </EmptyState>
    );
  }
  const rows = flatten(q.data);
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Kind of discussion" className="flex gap-2 overflow-x-auto pb-1">
          <ToggleChip selected={!kind} onClick={() => setKind(null)} className="shrink-0">
            All
          </ToggleChip>
          {DISCUSSION_KIND_KEYS.map((k) => (
            <ToggleChip key={k} selected={kind === k} onClick={() => setKind(kind === k ? null : k)} className="shrink-0">
              {DISCUSSION_KINDS[k]}
            </ToggleChip>
          ))}
        </div>
        {c.permissions.post && !composing && (
          <Button size="sm" onClick={() => setComposing(true)}>
            <Plus /> Start a discussion
          </Button>
        )}
      </div>
      {composing && <Composer c={c} onDone={() => setComposing(false)} />}
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No discussions yet">
          {c.permissions.post ? 'Ask a question or share something you’ve learned.' : 'Join to start the first one.'}
        </EmptyState>
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <ul className="mt-2">
            {rows.map((d) => (
              <DiscussionRow key={d.id} d={d} />
            ))}
          </ul>
        </InfiniteList>
      )}
    </div>
  );
}

const KIND_HELP: Record<DiscussionKind, string> = {
  DISCUSSION: 'Talk something through with the community.',
  QUESTION: 'Ask for help. You can mark the reply that answered it.',
  GUIDE: 'Share a technique, lesson or resource others can learn from.',
  MENTORSHIP: 'Offer or ask for guidance from more experienced members.',
  ANNOUNCEMENT: 'News from the community’s organisers.',
};

function Composer({ c, onDone }: { c: CommunityDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<DiscussionKind>('DISCUSSION');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kinds = DISCUSSION_KIND_KEYS.filter((k) => k !== 'ANNOUNCEMENT' || c.permissions.announce);
  async function submit() {
    const parsed = createDiscussionSchema.safeParse({ kind, title, body });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Please check the form');
    setBusy(true);
    try {
      await communitiesApi.createDiscussion(c.slug, parsed.data);
      await qc.invalidateQueries({ queryKey: ['communities'] });
      toast.success('Posted');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <Panel className="mt-3 space-y-3 p-4">
      <Field label="Type" hint={KIND_HELP[kind]}>
        {(a) => (
          <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as DiscussionKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {DISCUSSION_KINDS[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Title">{(a) => <Input {...a} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Details" hint="Mention someone with @username.">
        {(a) => <Textarea {...a} value={body} rows={5} maxLength={10000} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? 'Posting…' : 'Post'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

function About({ c }: { c: CommunityDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_--spacing(72)]">
      <Panel className="p-5">
        <h2 className="text-h3">Rules</h2>
        <p className="mt-2 text-small whitespace-pre-line text-text-1">{c.rules}</p>
        <p className="mt-4 text-caption text-text-3">{COMMUNITY_POLICIES[c.policy].help}</p>
        {c.interests.length > 0 && (
          <p className="mt-2 text-caption text-text-2">Genres: {c.interests.map((g) => GENRES[g as Genre] ?? g).join(', ')}</p>
        )}
        <p className="mt-2 text-caption text-text-3">
          Started {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
      </Panel>
      <Panel className="p-5">
        <h2 className="text-small font-semibold">People who run it</h2>
        <ul className="mt-3 space-y-2">
          {c.moderators.map((m) => (
            <li key={m.username}>
              <Link to={`/u/${m.username}`} className="flex items-center gap-3 hover:text-signal">
                <Avatar name={m.name} image={m.image} className="size-9 text-xs" />
                <span className="min-w-0 flex-1 truncate text-small font-semibold">{m.name}</span>
                <RoleBadge role={m.role} />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

const STATUS_TABS = [
  { value: 'ACTIVE', label: 'Members' },
  { value: 'PENDING', label: 'Requests' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'BANNED', label: 'Removed' },
] as const;

function Members({ c }: { c: CommunityDetail }) {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]['value']>('ACTIVE');
  const manage = c.permissions.manageMembers;
  const q = useInfiniteQuery({
    queryKey: communityKeys.members(c.slug, status),
    queryFn: ({ pageParam }) => communitiesApi.members(c.slug, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: c.canRead,
  });
  if (!c.canRead) return <EmptyState title="Members are visible to members">Join to see who’s here.</EmptyState>;
  const rows = flatten(q.data);
  return (
    <div className="space-y-4">
      {manage && (
        <>
          <div role="group" aria-label="Member list" className="flex gap-2 overflow-x-auto">
            {STATUS_TABS.map((t) => (
              <ToggleChip key={t.value} selected={status === t.value} onClick={() => setStatus(t.value)} className="shrink-0">
                {t.label}
                {t.value === 'PENDING' && c.pendingRequests > 0 ? ` (${c.pendingRequests})` : ''}
              </ToggleChip>
            ))}
          </div>
          <InviteForm c={c} />
        </>
      )}
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-small text-text-2">Nobody here.</p>
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <ul className="divide-y divide-hairline-strong">
            {rows.map((m) => (
              <MemberRow key={m.username} c={c} m={m} />
            ))}
          </ul>
        </InfiniteList>
      )}
    </div>
  );
}

function MemberRow({ c, m }: { c: CommunityDetail; m: MemberView }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: communityKeys.all });
      toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const self = me?.profile.username === m.username;
  const myRole = c.membership?.role;
  const [removeOpen, setRemoveOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Dialog open={removeOpen} onClose={() => setRemoveOpen(false)} title={`Remove ${m.name}?`}>
        <p className="mb-3 text-sm text-text-2">They’ll leave the community and can’t rejoin unless a moderator allows them back.</p>
        <Field label="Reason (shown to them, optional)" hint={`${reason.length}/500`}>
          {(a) => <Textarea {...a} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoveOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setRemoveOpen(false);
              void run(() => communitiesApi.memberAction(c.slug, m.username, 'ban', reason.trim() || undefined), `${m.name} was removed`);
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
      <Link to={`/u/${m.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-signal">
        <Avatar name={m.name} image={m.image} className="size-9 text-xs" />
        <span className="min-w-0">
          <span className="block truncate text-small font-semibold">{m.name}</span>
          {m.requestNote && <span className="block text-caption text-text-2">“{m.requestNote}”</span>}
        </span>
        <RoleBadge role={m.role} />
      </Link>
      {!self && c.permissions.manageMembers && (
        <div className="flex flex-wrap gap-2">
          {m.status === 'PENDING' && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => communitiesApi.memberAction(c.slug, m.username, 'approve'), `${m.name} joined`)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => communitiesApi.memberAction(c.slug, m.username, 'decline'), 'Request declined')}
              >
                Decline
              </Button>
            </>
          )}
          {m.status === 'BANNED' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => communitiesApi.memberAction(c.slug, m.username, 'unban'), `${m.name} can join again`)}
            >
              Allow back
            </Button>
          )}
          {m.status === 'ACTIVE' && m.role !== 'OWNER' && (
            <>
              {c.permissions.manageRoles && (
                <Select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  disabled={busy}
                  className="h-9 w-36 text-xs"
                  onChange={(e) =>
                    void run(
                      () => communitiesApi.setRole(c.slug, m.username, e.target.value as 'ADMIN' | 'MODERATOR' | 'MEMBER'),
                      'Role updated',
                    )
                  }
                >
                  <option value="MEMBER">Member</option>
                  <option value="MODERATOR">Moderator</option>
                  {myRole === 'OWNER' && <option value="ADMIN">Admin</option>}
                </Select>
              )}
              {myRole === 'OWNER' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    confirm(`Make ${m.name} the owner? You’ll become an admin.`) &&
                    void run(() => communitiesApi.memberAction(c.slug, m.username, 'owner'), 'Ownership transferred')
                  }
                >
                  Make owner
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoveOpen(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function InviteForm({ c }: { c: CommunityDetail }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!username.trim()) return;
        setBusy(true);
        try {
          await communitiesApi.invite(c.slug, username.trim().replace(/^@/, ''));
          toast.success('Invitation sent');
          setUsername('');
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Invite by username" className="mb-0 min-w-0 flex-1">
        {(a) => <Input {...a} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" />}
      </Field>
      <Button type="submit" variant="outline" disabled={busy}>
        Invite
      </Button>
    </form>
  );
}
