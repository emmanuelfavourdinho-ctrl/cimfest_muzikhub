import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Archive, ExternalLink, Pencil, Send, Trash2 } from 'lucide-react';
import { GENRES, LINK_PLATFORMS, PORTFOLIO_TYPES } from '@muzikhub/shared';
import { MediaBlock, ResponsiveImage } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Avatar, Eyebrow, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ReportButton } from '@/features/feed/ReportButton';
import { PlatformIcon } from '@/features/profile/SocialLinks';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { useInvalidateContent, usePortfolioItem } from '@/lib/social-queries';
import { useMe } from '@/lib/queries';
import { typeIcons } from './PortfolioCard';

export function PortfolioItemPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: item, isPending, isError, error, refetch } = usePortfolioItem(id);
  const invalidate = useInvalidateContent();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isPending) return <PageLoading />;
  if (isError) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <h1 className="text-2xl font-bold">This work isn't available</h1>
          <p className="mt-2 text-sm text-sage">It may be private, archived or deleted.</p>
        </div>
      );
    }
    return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const Icon = typeIcons[item.type];
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await invalidate();
      await refetch();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="mx-auto max-w-4xl">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {item.media && item.media.kind !== 'AUDIO' ? (
            <MediaBlock media={item.media} title={item.title} />
          ) : item.cover ? (
            <ResponsiveImage media={item.cover} alt={item.title} priority maxVariant="large" className="rounded-xl" sizes="(min-width: 1024px) 560px, 100vw" />
          ) : null}
          {item.media?.kind === 'AUDIO' && <MediaBlock media={item.media} title={item.title} />}
        </div>

        <div>
          <Eyebrow>
            <Icon className="size-3" aria-hidden /> {PORTFOLIO_TYPES[item.type].label}
          </Eyebrow>
          <h1 className="mt-2 text-[27px] leading-tight font-bold break-words">{item.title}</h1>
          <Link to={`/u/${item.owner.username}`} className="mt-3 flex items-center gap-2.5 rounded-lg py-1 text-sm hover:text-mint">
            <Avatar name={item.owner.name} image={item.owner.image} className="size-9 text-xs" />
            <span className="font-semibold">{item.owner.name}</span>
            <span className="text-sage">@{item.owner.username}</span>
          </Link>
          {item.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.map((g) => (
                <Pill key={g}>{GENRES[g]}</Pill>
              ))}
            </div>
          )}
          {item.description && <p className="mt-4 text-[13px] leading-[1.8] whitespace-pre-line text-[#b5d4c2]">{item.description}</p>}
          {item.credits && (
            <p className="mt-3 text-xs text-sage">
              <span className="font-semibold text-[#c2dacc]">Credits: </span>
              {item.credits}
            </p>
          )}
          {item.externalUrl && item.externalPlatform && (
            <Button asChild variant="outline" size="sm" className="mt-4">
              <a href={item.externalUrl} target="_blank" rel="noopener noreferrer nofollow">
                <PlatformIcon platform={item.externalPlatform} className="size-4" />
                {item.externalPlatform === 'WEBSITE' ? 'Open link' : `Open on ${LINK_PLATFORMS[item.externalPlatform].label}`}
                <ExternalLink />
              </a>
            </Button>
          )}
          {item.publishedAt && (
            <p className="mt-4 text-[11px] text-sage-dim">Published {new Date(item.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
          )}

          {item.isOwner ? (
            <Panel className="mt-5 p-4">
              <p className="mb-3 text-xs text-sage">
                Status: <strong className="text-foreground">{item.status.toLowerCase()}</strong> · {item.visibility === 'PUBLIC' ? 'Public' : 'Only you'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/studio/${item.id}/edit`}>
                    <Pencil /> Edit
                  </Link>
                </Button>
                {item.status === 'PUBLISHED' ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => api.archivePortfolio(item.id), 'Archived — hidden from your public profile')}>
                    <Archive /> Archive
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void act(() => api.publishPortfolio(item.id, false), 'Published')}>
                    <Send /> Publish
                  </Button>
                )}
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            </Panel>
          ) : me ? (
            <div className="mt-5">
              <ReportButton targetType="PORTFOLIO_ITEM" targetId={item.id} />
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this work?">
        <p className="mb-5 text-sm text-sage">
          “{item.title}” and its uploaded files will be permanently deleted, including any feed post that shares it. This can't be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.deletePortfolio(item.id);
                await invalidate();
                toast.success('Deleted');
                void navigate('/studio', { replace: true });
              } catch (e) {
                toast.error(errorMessage(e));
                setBusy(false);
              }
            }}
          >
            Delete permanently
          </Button>
        </div>
      </Dialog>
    </article>
  );
}
