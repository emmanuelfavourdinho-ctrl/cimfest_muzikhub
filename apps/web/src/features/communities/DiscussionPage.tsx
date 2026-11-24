import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, Check, Lightbulb, Lock, MessageSquareReply, Pin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DiscussionCommentView, DiscussionView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Textarea } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ReportButton } from '@/features/feed/ReportButton';
import { timeAgo } from '@/features/feed/PostCard';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { communitiesApi, communityKeys } from '@/lib/communities';
import { useMe } from '@/lib/queries';
import { flatten } from '@/lib/social-queries';
import { KindPill, RoleBadge } from './ui';

/** /communities/:slug/d/:id — one conversation: the post, then replies oldest first. */
export function DiscussionPage() {
  const { slug = '', id = '' } = useParams();
  const q = useQuery({ queryKey: communityKeys.discussion(id), queryFn: () => communitiesApi.discussion(id) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Discussion d={q.data} slug={slug} />;
}

/** A reason dialog for moderators (content removal is always explained to the author). */
function RemoveDialog({
  open,
  onClose,
  onConfirm,
  what,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  what: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={`Remove this ${what}?`}>
      <p className="mb-3 text-sm text-text-2">The author is told it was removed and why. Platform staff can review it.</p>
      <Field label="Reason (at least 5 characters)">
        {(a) => <Textarea {...a} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={busy || reason.trim().length < 5}
          onClick={async () => {
            setBusy(true);
            await onConfirm(reason.trim());
            setBusy(false);
            onClose();
          }}
        >
          Remove
        </Button>
      </div>
    </Dialog>
  );
}

function Discussion({ d, slug }: { d: DiscussionView; slug: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(d.title);
  const [body, setBody] = useState(d.body);
  const refresh = () => qc.invalidateQueries({ queryKey: ['discussion', d.id] });
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      await refresh();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <article className="mx-auto max-w-3xl">
      <Link to={`/communities/${slug}`} className="mb-3 inline-flex items-center gap-1 text-caption text-text-2 hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {d.community.name}
      </Link>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <KindPill kind={d.kind} />
          {d.pinned && (
            <span className="inline-flex items-center gap-1 text-caption text-text-2">
              <Pin aria-hidden className="size-3.5" /> Pinned
            </span>
          )}
          {d.locked && (
            <span className="inline-flex items-center gap-1 text-caption text-text-2">
              <Lock aria-hidden className="size-3.5" /> Locked: no new replies
            </span>
          )}
          {d.kind === 'QUESTION' && d.answered && <span className="text-caption text-success">Answered</span>}
        </div>
        {editing ? (
          <div className="mt-3 space-y-3">
            <Field label="Title">
              {(a) => <Textarea {...a} rows={2} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
            <Field label="Details">
              {(a) => <Textarea {...a} rows={6} value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void act(async () => {
                    await communitiesApi.updateDiscussion(d.id, { title, body });
                    setEditing(false);
                  }, 'Saved')
                }
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight break-words">{d.title}</h1>
            <div className="mt-3 flex items-center gap-3">
              <Link to={`/u/${d.author.username}`} className="flex items-center gap-2 hover:text-signal">
                <Avatar name={d.author.name} image={d.author.image} className="size-8 text-xs" />
                <span className="text-small font-semibold">{d.author.name}</span>
              </Link>
              <RoleBadge role={d.author.communityRole} />
              <span className="text-caption text-text-3">
                {timeAgo(d.createdAt)}
                {d.editedAt && ' · edited'}
              </span>
            </div>
            <p className="mt-4 text-body whitespace-pre-line text-text-1">{d.body}</p>
          </>
        )}
      </header>

      {me && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-hairline-strong py-2">
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={d.helpfulByMe}
            onClick={() => void act(() => communitiesApi.helpful(d.id, !d.helpfulByMe))}
            className={cn(d.helpfulByMe && 'text-signal')}
          >
            <Lightbulb /> Helpful{d.helpfulCount > 0 && ` · ${d.helpfulCount}`}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={d.followedByMe}
            onClick={() =>
              void act(
                () => communitiesApi.follow(d.id, !d.followedByMe),
                d.followedByMe ? 'You won’t get reply notices' : 'You’ll be told about replies',
              )
            }
          >
            {d.followedByMe ? <BellOff /> : <Bell />} {d.followedByMe ? 'Unfollow' : 'Follow replies'}
          </Button>
          {d.isAuthor && !editing && (
            <>
              <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  confirm('Delete this discussion and its replies?') &&
                  void act(async () => {
                    await communitiesApi.deleteDiscussion(d.id);
                    void navigate(`/communities/${slug}`);
                  }, 'Deleted')
                }
              >
                <Trash2 /> Delete
              </Button>
            </>
          )}
          {d.canModerate && (
            <>
              <Button size="sm" variant="quiet" onClick={() => void act(() => communitiesApi.moderate(d.id, d.pinned ? 'unpin' : 'pin'))}>
                <Pin /> {d.pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => void act(() => communitiesApi.moderate(d.id, d.locked ? 'unlock' : 'lock'))}>
                <Lock /> {d.locked ? 'Unlock' : 'Lock'}
              </Button>
              {!d.isAuthor && (
                <Button size="sm" variant="quiet" onClick={() => setRemoving(true)}>
                  Remove
                </Button>
              )}
            </>
          )}
          {!d.isAuthor && <ReportButton targetType="DISCUSSION" targetId={d.id} compact />}
        </div>
      )}
      <RemoveDialog
        open={removing}
        what="discussion"
        onClose={() => setRemoving(false)}
        onConfirm={async (reason) => {
          await act(async () => {
            await communitiesApi.removeDiscussion(d.id, reason);
            void navigate(`/communities/${slug}`);
          }, 'Removed');
        }}
      />
      <Replies d={d} />
    </article>
  );
}

function Replies({ d }: { d: DiscussionView }) {
  const { data: me } = useMe();
  const q = useInfiniteQuery({
    queryKey: communityKeys.comments(d.id),
    queryFn: ({ pageParam }) => communitiesApi.comments(d.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = flatten(q.data);
  const top = rows.filter((c) => !c.parentId);
  const repliesTo = (id: string) => rows.filter((c) => c.parentId === id);
  return (
    <section aria-labelledby="replies" className="mt-6">
      <h2 id="replies" className="text-h3">
        {d.commentCount} {d.commentCount === 1 ? 'reply' : 'replies'}
      </h2>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <InfiniteList
          hasNextPage={q.hasNextPage}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={() => void q.fetchNextPage()}
          isError={q.isError}
        >
          <ol className="mt-3 space-y-4">
            {top.map((c) => (
              <li key={c.id}>
                <Reply c={c} d={d} />
                {repliesTo(c.id).length > 0 && (
                  <ol className="mt-3 ml-6 space-y-3 border-l border-hairline-strong pl-4">
                    {repliesTo(c.id).map((r) => (
                      <li key={r.id}>
                        <Reply c={r} d={d} nested />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </InfiniteList>
      )}
      {me && !d.locked && <ReplyBox d={d} />}
      {d.locked && <p className="mt-4 text-small text-text-2">This discussion is locked. No new replies.</p>}
    </section>
  );
}

function Reply({ c, d, nested }: { c: DiscussionCommentView; d: DiscussionView; nested?: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: communityKeys.comments(d.id) }),
      qc.invalidateQueries({ queryKey: communityKeys.discussion(d.id) }),
    ]);
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      await refresh();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const canAccept = d.kind === 'QUESTION' && (d.isAuthor || d.canModerate);
  return (
    <div className={cn('rounded-s', c.accepted && 'border border-success/40 bg-success/10 p-3')}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/u/${c.author.username}`} className="flex items-center gap-2 hover:text-signal">
          <Avatar name={c.author.name} image={c.author.image} className="size-7 text-xs" />
          <span className="text-small font-semibold">{c.author.name}</span>
        </Link>
        <RoleBadge role={c.author.communityRole} />
        <span className="text-caption text-text-3">
          {timeAgo(c.createdAt)}
          {c.editedAt && ' · edited'}
        </span>
        {c.accepted && (
          <span className="inline-flex items-center gap-1 text-caption text-success">
            <Check aria-hidden className="size-3.5" /> Accepted answer
          </span>
        )}
      </div>
      <p className="mt-1.5 text-small whitespace-pre-line text-text-1">{c.body}</p>
      {me && (
        <div className="mt-1 flex flex-wrap gap-1">
          {!nested && !d.locked && (
            <Button size="sm" variant="quiet" onClick={() => setReplying((v) => !v)}>
              <MessageSquareReply /> Reply
            </Button>
          )}
          {canAccept && !nested && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                void act(() => communitiesApi.answer(d.id, c.accepted ? null : c.id), c.accepted ? undefined : 'Marked as the answer')
              }
            >
              <Check /> {c.accepted ? 'Unmark answer' : 'Mark as answer'}
            </Button>
          )}
          {c.isAuthor && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => confirm('Delete this reply?') && void act(() => communitiesApi.deleteComment(c.id), 'Deleted')}
            >
              Delete
            </Button>
          )}
          {c.canModerate && !c.isAuthor && (
            <Button size="sm" variant="quiet" onClick={() => setRemoving(true)}>
              Remove
            </Button>
          )}
          {!c.isAuthor && <ReportButton targetType="DISCUSSION_COMMENT" targetId={c.id} compact />}
        </div>
      )}
      {replying && <ReplyBox d={d} parentId={c.id} onDone={() => setReplying(false)} />}
      <RemoveDialog
        open={removing}
        what="reply"
        onClose={() => setRemoving(false)}
        onConfirm={(reason) => act(() => communitiesApi.removeComment(c.id, reason), 'Removed')}
      />
    </div>
  );
}

function ReplyBox({ d, parentId, onDone }: { d: DiscussionView; parentId?: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await communitiesApi.addComment(d.id, body.trim(), parentId);
          setBody('');
          await Promise.all([
            qc.invalidateQueries({ queryKey: communityKeys.comments(d.id) }),
            qc.invalidateQueries({ queryKey: communityKeys.discussion(d.id) }),
          ]);
          onDone?.();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={parentId ? 'Your reply' : 'Add a reply'} hint="Mention someone with @username.">
        {(a) => <Textarea {...a} value={body} rows={parentId ? 2 : 3} maxLength={4000} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <FormError message={error} />
      <Button type="submit" size="sm" disabled={busy || !body.trim()}>
        {busy ? 'Posting…' : 'Reply'}
      </Button>
    </form>
  );
}
