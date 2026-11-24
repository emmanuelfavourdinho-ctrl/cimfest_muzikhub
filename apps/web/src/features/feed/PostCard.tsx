import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { Heart, Link2, Megaphone, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PostView } from '@muzikhub/shared';
import { MediaBlock, ResponsiveImage } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/form';
import { Avatar, Panel, Pill } from '@/components/ui/primitives';
import { PortfolioCard } from '@/features/portfolio/PortfolioCard';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { flatten, socialKeys, useInvalidateContent, useToggleLike, useUpdateCachedPost } from '@/lib/social-queries';
import { ReportButton } from './ReportButton';

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** `promoted`: rendered in the paid Promoted slot (mandatory label; never mixed into organic lists). */
export function PostCard({ post, promoted }: { post: PostView; promoted?: boolean }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toggleLike = useToggleLike();
  const updateCached = useUpdateCachedPost();
  const invalidate = useInvalidateContent();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const requireSignIn = () => {
    if (me) return true;
    void navigate(`/login?next=${encodeURIComponent(`/p/${post.id}`)}`);
    return false;
  };

  async function copyLink() {
    const url = `${window.location.origin}/p/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  async function saveEdit() {
    try {
      const updated = await api.updatePost(post.id, draft.trim());
      updateCached(post.id, () => updated);
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove() {
    try {
      await api.deletePost(post.id);
      setConfirmDelete(false);
      await invalidate();
      toast.success('Post deleted');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const images = post.media.filter((m) => m.kind === 'IMAGE');
  const other = post.media.filter((m) => m.kind !== 'IMAGE');

  return (
    <Panel
      className={cn('p-4 sm:p-5', promoted && 'border-control-border')}
      aria-label={promoted ? `Promoted post by ${post.author.name}` : undefined}
    >
      {promoted && (
        <p className="mb-3 flex items-center gap-2 text-caption text-text-2">
          <Pill variant="gold">Promoted</Pill>
          <span>Paid placement</span>
        </p>
      )}
      <header className="flex items-center gap-3">
        {/* Same destination as the name link beside it: kept for mouse/touch, hidden from AT and Tab. */}
        <Link to={`/u/${post.author.username}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <Avatar name={post.author.name} image={post.author.image} className="size-10 text-xs" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/u/${post.author.username}`} className="block min-h-6 truncate text-sm leading-6 font-semibold hover:text-signal">
            {post.author.name}
          </Link>
          <p className="text-xs text-text-2">
            @{post.author.username} ·{' '}
            <Link to={`/p/${post.id}`} className="hover:underline">
              <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
            </Link>
            {post.editedAt && ' · edited'}
            {post.type === 'SHOWCASE' && ' · shared work'}
          </p>
        </div>
        {post.isAuthor ? (
          <div className="flex">
            <Button asChild variant="quiet" size="icon">
              <Link to={`/promote?product=POST_BOOST&targetId=${encodeURIComponent(post.id)}`} aria-label="Boost post">
                <Megaphone />
              </Link>
            </Button>
            {post.type !== 'SHOWCASE' && (
              <Button variant="quiet" size="icon" aria-label="Edit post" onClick={() => setEditing((v) => !v)}>
                <Pencil />
              </Button>
            )}
            <Button variant="quiet" size="icon" aria-label="Delete post" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          </div>
        ) : me ? (
          <ReportButton targetType="POST" targetId={post.id} compact />
        ) : null}
      </header>

      {editing ? (
        <div className="mt-3">
          <Textarea aria-label="Edit post" value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveEdit()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        post.body && <p className="mt-3 text-sm leading-relaxed whitespace-pre-line break-words text-text-1">{post.body}</p>
      )}

      {images.length > 0 && (
        <div className={cn('mt-3 grid gap-1.5 overflow-hidden rounded-xl', images.length > 1 && 'grid-cols-2')}>
          {images.map((m, i) => (
            <ResponsiveImage
              key={m.id}
              media={m}
              alt={`Image ${i + 1} from ${post.author.name}`}
              aspect={images.length > 1 ? '1 / 1' : undefined}
              sizes={images.length > 1 ? '(min-width: 768px) 320px, 50vw' : '(min-width: 768px) 640px, 100vw'}
            />
          ))}
        </div>
      )}
      {other.map((m) => (
        <div key={m.id} className="mt-3">
          <MediaBlock
            media={m}
            title={post.body?.slice(0, 60) || `Post by ${post.author.name}`}
            track={{ subjectType: 'POST', subjectId: post.id }}
          />
        </div>
      ))}
      {post.portfolioItem && (
        <div className="mt-3 max-w-xs">
          <PortfolioCard item={post.portfolioItem} />
          {post.portfolioItem.media && post.portfolioItem.media.kind === 'AUDIO' && (
            <div className="mt-2">
              <MediaBlock
                media={post.portfolioItem.media}
                title={post.portfolioItem.title}
                track={{ subjectType: 'PORTFOLIO_ITEM', subjectId: post.portfolioItem.id }}
              />
            </div>
          )}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-1 border-t border-hairline-strong pt-2">
        <Button
          variant="quiet"
          size="sm"
          aria-pressed={post.likedByMe}
          aria-label={post.likedByMe ? 'Unlike' : 'Like'}
          onClick={() =>
            requireSignIn() && toggleLike.mutate({ post, liked: !post.likedByMe }, { onError: (e) => toast.error(errorMessage(e)) })
          }
          className={cn(post.likedByMe && 'text-danger')}
        >
          <Heart className={cn(post.likedByMe && 'fill-current')} /> {post.likeCount > 0 && post.likeCount}
        </Button>
        <Button variant="quiet" size="sm" aria-expanded={showComments} onClick={() => setShowComments((v) => !v)}>
          <MessageCircle /> {post.commentCount > 0 ? post.commentCount : 'Comment'}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => void copyLink()} className="ml-auto">
          <Link2 /> Copy link
        </Button>
      </footer>
      {showComments && <Comments post={post} onRequireSignIn={requireSignIn} />}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this post?">
        <p className="mb-5 text-sm text-text-2">The post, its comments and its uploaded media will be deleted permanently.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

function Comments({ post, onRequireSignIn }: { post: PostView; onRequireSignIn: () => boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const updateCached = useUpdateCachedPost();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const query = useInfiniteQuery({
    queryKey: socialKeys.comments(post.id),
    queryFn: ({ pageParam }) => api.comments(post.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const comments = flatten(query.data);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!onRequireSignIn() || !body.trim()) return;
    setSending(true);
    try {
      await api.addComment(post.id, body.trim());
      setBody('');
      await qc.invalidateQueries({ queryKey: socialKeys.comments(post.id) });
      updateCached(post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
    } catch (err) {
      toast.error(errorMessage(err)); // the typed comment stays in the box for retry
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteComment(id);
      await qc.invalidateQueries({ queryKey: socialKeys.comments(post.id) });
      updateCached(post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {query.isPending ? (
        <p className="text-xs text-text-2">Loading comments…</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive">
          Couldn't load comments.{' '}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-text-2">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.author.name} image={c.author.image} className="size-8 shrink-0 text-xs" />
              <div className="min-w-0 flex-1 rounded-xl bg-surface-overlay px-3 py-2">
                <p className="text-xs">
                  <Link to={`/u/${c.author.username}`} className="font-semibold hover:text-signal">
                    {c.author.name}
                  </Link>
                  <span className="ml-1.5 text-text-3">{timeAgo(c.createdAt)}</span>
                </p>
                <p className="mt-0.5 text-caption whitespace-pre-line break-words text-text-1">{c.body}</p>
              </div>
              {c.canDelete && (
                <Button variant="quiet" size="icon" aria-label="Delete comment" onClick={() => void remove(c.id)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button variant="link" size="sm" onClick={() => void query.fetchNextPage()}>
          Show more comments
        </Button>
      )}
      {me ? (
        <form onSubmit={send} className="flex gap-2">
          <input
            aria-label="Write a comment"
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a thoughtful comment…"
            className="h-10 min-w-0 flex-1 rounded-s border border-control-border bg-surface-raised px-3 text-sm outline-none focus:border-signal"
          />
          <Button type="submit" size="sm" disabled={sending || !body.trim()}>
            Post
          </Button>
        </form>
      ) : (
        <p className="text-xs text-text-2">
          <Link to="/login" className="text-signal hover:underline">
            Sign in
          </Link>{' '}
          to comment.
        </p>
      )}
    </div>
  );
}
