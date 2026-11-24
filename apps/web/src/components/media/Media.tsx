import { useState } from 'react';
import { cn } from '@/lib/cn';
import { ImageOff, Music2, Play } from 'lucide-react';
import type { MediaView } from '@muzikhub/shared';

/**
 * Cloudinary image with a srcset, so phones download the 320/640px variant instead of the
 * original. Lazy by default; pass `priority` only for above-the-fold images.
 * Reserves its aspect ratio so the layout doesn't jump while loading.
 */
export function ResponsiveImage({
  media,
  alt,
  sizes = '(min-width: 1024px) 33vw, 100vw',
  className,
  priority = false,
  aspect,
  maxVariant = 'wide',
}: {
  media: MediaView;
  alt: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
  /** CSS aspect-ratio, e.g. "4 / 3". Defaults to the image's own ratio. */
  aspect?: string;
  /**
   * Largest variant offered. Feeds/cards stop at 960w so dense phone screens (≈2.6×)
   * don't download 1280w images on mobile data; detail pages may use 'large'.
   */
  maxVariant?: 'wide' | 'large';
}) {
  const [failed, setFailed] = useState(false);
  const { small, medium, wide, large } = media.urls;
  const ratio = aspect ?? (media.width && media.height ? `${media.width} / ${media.height}` : '4 / 3');

  if (failed || !medium) {
    return (
      <div
        role="img"
        aria-label={alt || 'Image unavailable'}
        style={{ aspectRatio: ratio }}
        className={cn('flex items-center justify-center bg-surface-overlay text-text-3', className)}
      >
        <ImageOff className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={medium}
      srcSet={[`${small} 320w`, `${medium} 640w`, wide && `${wide} 960w`, maxVariant === 'large' && large && `${large} 1280w`]
        .filter(Boolean)
        .join(', ')}
      sizes={sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      onError={() => setFailed(true)}
      style={{ aspectRatio: ratio }}
      className={cn('w-full bg-surface-overlay object-cover', className)}
    />
  );
}

/** Native audio element (accessible, keyboard-friendly). preload="none": nothing downloads until play. */
export function AudioPlayer({ media, title }: { media: MediaView; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-control-border bg-surface-overlay p-3">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-chip text-signal">
        <Music2 className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 truncate text-xs font-semibold text-text-1">
          {title}
          {media.durationSec ? <span className="ml-2 font-normal text-text-3">{formatDuration(media.durationSec)}</span> : null}
        </p>
        {failed ? (
          <p className="text-xs text-destructive">This audio couldn't be loaded.</p>
        ) : (
          // User uploads carry no caption files yet (captions: tracked gap in docs/traceability.md).
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <audio
            controls
            preload="none"
            src={media.urls.src}
            onError={() => setFailed(true)}
            className="h-9 w-full"
            aria-label={`Play ${title}`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Shows only the poster until the user presses play; the video itself is never
 * fetched or autoplayed before that (CLAUDE.md low-bandwidth rules).
 */
export function VideoPlayer({ media, title }: { media: MediaView; title: string }) {
  const [playing, setPlaying] = useState(false);
  const ratio = media.width && media.height ? `${media.width} / ${media.height}` : '16 / 9';
  if (playing) {
    return (
      // autoPlay is fine here: the user explicitly pressed play a moment ago.
      // User uploads carry no caption files yet (captions: tracked gap in docs/traceability.md).
      // oxlint-disable-next-line jsx-a11y/media-has-caption
      <video
        controls
        autoPlay
        playsInline
        src={media.urls.src}
        poster={media.urls.poster}
        style={{ aspectRatio: ratio }}
        className="w-full rounded-xl bg-black"
        aria-label={title}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="group relative block w-full overflow-hidden rounded-xl bg-black"
      style={{ aspectRatio: ratio }}
      aria-label={`Play video: ${title}`}
    >
      {media.urls.poster && (
        <img src={media.urls.poster} alt="" loading="lazy" decoding="async" className="size-full object-cover opacity-90" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-signal text-on-signal shadow-glow transition group-hover:scale-105">
          <Play className="ml-0.5 size-6 fill-current" />
        </span>
      </span>
      {media.durationSec ? (
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
          {formatDuration(media.durationSec)}
        </span>
      ) : null}
    </button>
  );
}

export function MediaBlock({ media, title }: { media: MediaView; title: string }) {
  if (media.kind === 'AUDIO') return <AudioPlayer media={media} title={title} />;
  if (media.kind === 'VIDEO') return <VideoPlayer media={media} title={title} />;
  return <ResponsiveImage media={media} alt={title} className="rounded-xl" maxVariant="large" sizes="(min-width: 1024px) 560px, 100vw" />;
}

export function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
