import { useState } from 'react';
import { ImagePlus, Music2, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_POST_IMAGES, POST_BODY_MAX, type MediaKind, type MediaView } from '@muzikhub/shared';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Avatar, Panel } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { useInvalidateContent } from '@/lib/social-queries';

// Keyed per account so another person signing in on this device never sees it.
const draftKey = (userId: string) => `muzikhub:post-draft:${userId}`;
const readDraft = (userId: string | undefined) => {
  if (!userId) return '';
  try {
    return localStorage.getItem(draftKey(userId)) ?? '';
  } catch {
    return '';
  }
};
const writeDraft = (userId: string, v: string) => {
  try {
    if (v) localStorage.setItem(draftKey(userId), v);
    else localStorage.removeItem(draftKey(userId));
  } catch {
    /* storage unavailable (private mode) — the draft just isn't kept */
  }
};

/**
 * Create a post: text, up to 4 images, or one audio/video file. The text draft survives
 * reloads and dropped connections (kept in this browser only until it's posted).
 */
export function Composer() {
  const { data: me } = useMe();
  const invalidate = useInvalidateContent();
  const [body, setBody] = useState(() => readDraft(me?.id));
  const [attachKind, setAttachKind] = useState<MediaKind | null>(null);
  const [media, setMedia] = useState<MediaView[]>([]);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Restricted accounts can't post (the server refuses too); the banner explains why.
  if (!me || me.accountStatus !== 'ACTIVE') return null;

  const update = (v: string) => {
    setBody(v);
    writeDraft(me.id, v);
  };
  const canAddImage = attachKind === 'IMAGE' && media.length < MAX_POST_IMAGES;

  async function post() {
    setPosting(true);
    try {
      await api.createPost({ body: body.trim(), mediaIds: media.map((m) => m.id) });
      update('');
      setMedia([]);
      setAttachKind(null);
      await invalidate();
      toast.success('Posted');
    } catch (e) {
      toast.error(errorMessage(e)); // text and attachments are kept so the user can retry
    } finally {
      setPosting(false);
    }
  }

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex gap-3">
        <Avatar name={me.profile.name} image={me.profile.image} className="size-10 shrink-0 text-xs" />
        <textarea
          aria-label="Share something with the community"
          value={body}
          maxLength={POST_BODY_MAX}
          onChange={(e) => update(e.target.value)}
          placeholder="What are you working on? Share a clip, a beat or an update…"
          className="min-h-20 w-full resize-y bg-transparent text-sm text-foreground outline-none placeholder:text-text-3"
        />
      </div>

      {media.length > 0 && attachKind === 'IMAGE' && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {media.map((m) => (
            <div key={m.id} className="relative">
              <img src={m.urls.small} alt="" className="aspect-square w-full rounded-lg object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => {
                  void api.deleteUpload(m.id).catch(() => undefined);
                  setMedia(media.filter((x) => x.id !== m.id));
                }}
                className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-white"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachKind && (attachKind !== 'IMAGE' || canAddImage) && (
        <div className="mt-3">
          <MediaUploader
            key={media.length}
            purpose="POST"
            kinds={[attachKind]}
            value={attachKind === 'IMAGE' ? null : (media[0] ?? null)}
            onChange={(m) => setMedia(attachKind === 'IMAGE' ? (m ? [...media, m] : media) : m ? [m] : [])}
            label={
              attachKind === 'IMAGE'
                ? `Add an image (${media.length}/${MAX_POST_IMAGES})`
                : attachKind === 'AUDIO'
                  ? 'Choose an audio file'
                  : 'Choose a video'
            }
            previewTitle={body.slice(0, 60) || 'Your post'}
            onBusyChange={setUploading}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-hairline-strong pt-3">
        {(
          [
            ['IMAGE', ImagePlus, 'Images'],
            ['AUDIO', Music2, 'Audio'],
            ['VIDEO', Video, 'Video'],
          ] as const
        ).map(([kind, Icon, label]) => (
          <Button
            key={kind}
            type="button"
            variant="quiet"
            size="sm"
            aria-pressed={attachKind === kind}
            disabled={media.length > 0 && attachKind !== kind}
            onClick={() => setAttachKind(attachKind === kind && media.length === 0 ? null : kind)}
          >
            <Icon /> {label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-text-3">{body.length > POST_BODY_MAX - 200 && `${body.length}/${POST_BODY_MAX}`}</span>
        <Button size="sm" disabled={posting || uploading || (!body.trim() && media.length === 0)} onClick={() => void post()}>
          {posting ? 'Posting…' : uploading ? 'Uploading…' : 'Post'}
        </Button>
      </div>
    </Panel>
  );
}
