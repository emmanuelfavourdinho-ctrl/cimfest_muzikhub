import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  createPortfolioSchema,
  normaliseHttpsUrl,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_TYPE_KEYS,
  PORTFOLIO_TYPES,
  publishProblem,
  type Genre,
  type MediaView,
  type PortfolioItemView,
  type PortfolioType,
  type Visibility,
} from '@muzikhub/shared';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { GenrePicker } from '@/features/profile/pickers';
import { api, errorMessage } from '@/lib/api';
import { useInvalidateContent, usePortfolioItem } from '@/lib/social-queries';
import { typeIcons } from './PortfolioCard';

/** /studio/new and /studio/:id/edit */
export function PortfolioEditorPage() {
  const { id } = useParams();
  const { data: item, isPending, isError } = usePortfolioItem(id);
  if (!id) return <PortfolioEditor />;
  if (isPending) return <PageLoading />;
  if (isError || !item.isOwner) return <Navigate to="/studio" replace />;
  return <PortfolioEditor existing={item} />;
}

function PortfolioEditor({ existing }: { existing?: PortfolioItemView }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateContent();
  const [type, setType] = useState<PortfolioType>(existing?.type ?? 'AUDIO');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [genres, setGenres] = useState<Genre[]>(existing?.genres ?? []);
  const [credits, setCredits] = useState(existing?.credits ?? '');
  const [externalUrl, setExternalUrl] = useState(existing?.externalUrl ?? '');
  const [media, setMedia] = useState<MediaView | null>(existing?.media ?? null);
  const [cover, setCover] = useState<MediaView | null>(existing?.cover ?? null);
  const [visibility, setVisibility] = useState<Visibility>(existing?.visibility ?? 'PUBLIC');
  const [featured, setFeatured] = useState(existing?.featured ?? false);
  const [shareToFeed, setShareToFeed] = useState(true); // approved: opt-in, ticked by default
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
  // Count, not boolean: the media file and the cover can upload at the same time.
  const [uploads, setUploads] = useState(0);
  const trackUpload = (busy: boolean) => setUploads((n) => Math.max(0, n + (busy ? 1 : -1)));
  const blocked = saving !== null || uploads > 0;

  const accepts = PORTFOLIO_TYPES[type].media;
  const isPublished = existing?.status === 'PUBLISHED';

  function chooseType(next: PortfolioType) {
    setType(next);
    // A file of the wrong kind can't stay attached (the server would reject it anyway).
    if (media && !(PORTFOLIO_TYPES[next].media as readonly string[]).includes(media.kind)) setMedia(null);
  }

  function payload() {
    const link = externalUrl.trim();
    if (link && !normaliseHttpsUrl(link)) throw new Error('The link must be a full https:// address.');
    return {
      type,
      title: title.trim(),
      description: description.trim() || null,
      genres,
      credits: credits.trim() || null,
      externalUrl: link || null,
      mediaId: media?.id ?? null,
      coverId: cover?.id ?? null,
      visibility,
      featured,
    };
  }

  async function save(mode: 'draft' | 'publish') {
    setError(null);
    try {
      const data = payload();
      const parsed = createPortfolioSchema.safeParse(data);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Please check the form.');
      if (mode === 'publish' || isPublished) {
        const problem = publishProblem({ type, hasMedia: Boolean(media), externalUrl: data.externalUrl, description: data.description });
        if (problem) throw new Error(problem);
      }
      setSaving(mode);
      const share = mode === 'publish' && visibility === 'PUBLIC' && shareToFeed;
      let saved: PortfolioItemView;
      if (existing) {
        saved = await api.updatePortfolio(existing.id, data);
        if (mode === 'publish' && !isPublished) saved = await api.publishPortfolio(existing.id, share);
      } else {
        saved = await api.createPortfolio({ ...data, publish: mode === 'publish', shareToFeed: share });
      }
      await invalidate();
      toast.success(mode === 'publish' && !isPublished ? (share ? 'Published and shared to the feed' : 'Published') : 'Saved');
      void navigate(`/work/${saved.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(isPublished ? 'draft' : 'publish');
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Creator studio"
        title={existing ? 'Edit work' : 'Add work'}
        description="Show people what you make. You can save a draft and publish later."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Panel className="p-5 sm:p-6">
          <fieldset>
            <legend className="mb-2.5 text-xs font-bold text-text-1">What kind of work is it?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PORTFOLIO_TYPE_KEYS.map((key) => {
                const Icon = typeIcons[key];
                const selected = key === type;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseType(key)}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-xs font-semibold transition ${selected ? 'border-signal bg-surface-chip text-signal' : 'border-control-border bg-surface-overlay text-text-2 hover:border-control-border'}`}
                  >
                    <Icon className="size-5" aria-hidden />
                    {PORTFOLIO_TYPES[key].label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <Field label="Title">
            {(a) => (
              <Input {...a} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midnight Makossa" />
            )}
          </Field>
          {accepts.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-bold text-text-1">
                {type === 'VIDEO' ? 'Video file' : type === 'IMAGE' ? 'Image' : 'Audio file'}
              </p>
              <MediaUploader
                purpose="PORTFOLIO"
                kinds={accepts}
                value={media}
                onChange={setMedia}
                label={`Choose ${type === 'VIDEO' ? 'a video' : type === 'IMAGE' ? 'an image' : 'an audio file'}`}
                previewTitle={title || 'Preview'}
                onBusyChange={trackUpload}
              />
            </div>
          )}
          {type !== 'IMAGE' && (
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-bold text-text-1">
                Cover image <span className="font-normal text-text-3">(optional)</span>
              </p>
              <MediaUploader
                purpose="PORTFOLIO"
                kinds={['IMAGE']}
                value={cover}
                onChange={setCover}
                label="Choose a cover image"
                onBusyChange={trackUpload}
              />
            </div>
          )}
          <Field
            label="Link"
            hint={
              accepts.length > 0
                ? 'Optional — or use a link instead of uploading (YouTube, SoundCloud, Spotify…).'
                : 'Where can people see or hear this project?'
            }
          >
            {(a) => (
              <Input
                {...a}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
            )}
          </Field>
          <Field label="Description" hint={`${description.length}/${PORTFOLIO_DESCRIPTION_MAX}`}>
            {(a) => (
              <Textarea
                {...a}
                value={description}
                maxLength={PORTFOLIO_DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="The story behind it, the tools you used, what you're looking for…"
              />
            )}
          </Field>
          <Field label="Credits" hint="Optional, e.g. “Produced by Kora Beats · Mixed by …”">
            {(a) => <Input {...a} value={credits} maxLength={500} onChange={(e) => setCredits(e.target.value)} />}
          </Field>
          <p className="mb-2.5 text-xs font-bold text-text-1">Genres</p>
          <GenrePicker label="Genres" value={genres} onChange={setGenres} max={5} />
        </Panel>

        <Panel className="space-y-3 p-5 sm:p-6">
          <fieldset>
            <legend className="mb-2 text-xs font-bold text-text-1">Who can see it?</legend>
            {(['PUBLIC', 'PRIVATE'] as const).map((v) => (
              <label key={v} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  className="size-4 accent-signal"
                />
                {v === 'PUBLIC' ? 'Public — anyone can see it on your profile and in discovery' : 'Private — only you'}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="size-4 accent-signal" />
            Feature it at the top of my portfolio
          </label>
          {!isPublished && visibility === 'PUBLIC' && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={shareToFeed}
                onChange={(e) => setShareToFeed(e.target.checked)}
                className="size-4 accent-signal"
              />
              Share to the feed when I publish
            </label>
          )}
        </Panel>

        <div className="flex flex-wrap justify-end gap-2 pb-4">
          {isPublished ? (
            <Button type="submit" disabled={blocked}>
              {saving ? 'Saving…' : uploads ? 'Uploading…' : 'Save changes'}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={blocked} onClick={() => void save('draft')}>
                {saving === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="submit" disabled={blocked}>
                {saving === 'publish' ? 'Publishing…' : uploads ? 'Uploading…' : 'Publish'}
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
