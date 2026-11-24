import { useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import photos from '@/features/home/hero-photos.json';

/**
 * Cinematic landing backdrop: the five approved photographs (2026-11-24), crossfading with a
 * very slow zoom under a Deep Forest overlay. Purely atmospheric — images are decorative
 * (alt=""), with no names or captions, so nothing implies endorsement.
 *
 * Loading: only the first photo is requested at startup (high priority). Each next photo is
 * mounted — and therefore downloaded — one slide ahead. Reduced motion: one still photo.
 * Hidden tab: the sequence pauses.
 */

type Photo = (typeof photos)[number];

/** How each photograph is composed. Different shapes and qualities need different treatment. */
const COMPOSITION: Record<string, { mobile: string; desktop: string; fit: 'cover' | 'contain'; overlay: 'normal' | 'strong' }> = {
  // 1280×1006 — strong landscape, covers large screens well.
  'red-studio': { mobile: '64% 28%', desktop: '72% 32%', fit: 'cover', overlay: 'normal' },
  // 737×1080 portrait — cover on phones; on desktop shown at natural size on the right.
  'coral-portrait': { mobile: '50% 18%', desktop: 'center', fit: 'contain', overlay: 'normal' },
  // 333×500 low-resolution concert photo — never enlarged on desktop (contain at ≤ natural size).
  'stage-saxophone': { mobile: '45% 25%', desktop: 'center', fit: 'contain', overlay: 'normal' },
  // 1080×955, bright white background — deeper overlay for contrast.
  'blue-studio': { mobile: '50% 22%', desktop: '70% 30%', fit: 'cover', overlay: 'strong' },
  // 900×900, bright white background — deeper overlay for contrast.
  'pointing-studio': { mobile: '58% 30%', desktop: '72% 35%', fit: 'cover', overlay: 'strong' },
};

export const SLIDE_MS = 7000;

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function HeroBackdrop() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  /** How many slides are mounted (and so downloaded). Grows one ahead of the active slide. */
  const [mounted, setMounted] = useState(1);
  const loaded = useRef(new Set<number>());
  const [firstLoaded, setFirstLoaded] = useState(false);

  // Once the first photo has loaded, fetch the next one in the background.
  useEffect(() => {
    if (reduced || !firstLoaded) return;
    setMounted((m) => Math.max(m, Math.min(active + 2, photos.length)));
  }, [active, firstLoaded, reduced]);

  // Advance every SLIDE_MS — only while the tab is visible and the next photo is ready.
  useEffect(() => {
    if (reduced || !firstLoaded) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer = setInterval(() => {
        setActive((current) => {
          const next = (current + 1) % photos.length;
          return loaded.current.has(next) ? next : current; // wait for slow networks
        });
      }, SLIDE_MS);
    };
    const onVisibility = () => {
      clearInterval(timer);
      if (!document.hidden) start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced, firstLoaded]);

  const slides = (reduced ? photos.slice(0, 1) : photos.slice(0, mounted)) as Photo[];

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-forest-950" data-testid="hero-backdrop" data-active={photos[active]?.slug}>
      {slides.map((photo, i) => (
        <Slide
          key={photo.slug}
          photo={photo}
          index={i}
          visible={i === active}
          animate={!reduced && i === active}
          onLoad={() => {
            loaded.current.add(i);
            if (i === 0) setFirstLoaded(true);
          }}
        />
      ))}
      {/* Deep Forest overlay: strongest behind the text (left on desktop, bottom on mobile). */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-[1800ms]',
          'bg-[linear-gradient(180deg,rgba(6,22,18,.35)_0%,rgba(6,22,18,.55)_45%,rgba(6,22,18,.94)_100%)]',
          'md:bg-[linear-gradient(90deg,rgba(6,22,18,.96)_0%,rgba(6,22,18,.85)_38%,rgba(6,22,18,.35)_70%,rgba(6,22,18,.55)_100%)]',
        )}
      />
      {COMPOSITION[photos[active]?.slug ?? '']?.overlay === 'strong' && <div className="absolute inset-0 bg-[rgba(6,22,18,.42)] transition-opacity duration-[1800ms]" />}
      <span className="absolute right-0 bottom-0 h-0.5 w-2/5 bg-[linear-gradient(90deg,transparent,#4cf7ae,transparent)]" />
    </div>
  );
}

function Slide({ photo, index, visible, animate, onLoad }: { photo: Photo; index: number; visible: boolean; animate: boolean; onLoad: () => void }) {
  const c = COMPOSITION[photo.slug] ?? { mobile: 'center', desktop: 'center', fit: 'cover' as const, overlay: 'normal' as const };
  const srcSet = photo.srcset.map((s) => `${s.url} ${s.w}w`).join(', ');
  const largest = photo.srcset[photo.srcset.length - 1]!;
  const first = index === 0;
  const img = (className: string, sizes: string, style: React.CSSProperties) => (
    <img
      src={largest.url}
      srcSet={srcSet}
      sizes={sizes}
      alt=""
      width={photo.width}
      height={photo.height}
      // Only the first photo is high priority; it is the landing page's LCP element.
      fetchPriority={first ? 'high' : 'low'}
      loading={first ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={onLoad}
      className={className}
      style={style}
    />
  );

  return (
    <div
      data-slide={photo.slug}
      data-visible={visible}
      className={cn('absolute inset-0 transition-opacity duration-[1800ms] ease-in-out', visible ? 'opacity-100' : 'opacity-0')}
    >
      {c.fit === 'cover' ? (
        <div className={cn('absolute inset-0', animate && 'hero-kenburns')}>
          {img('size-full object-cover [object-position:var(--pos-m)] md:[object-position:var(--pos-d)]', '100vw', {
            ['--pos-m' as string]: c.mobile,
            ['--pos-d' as string]: c.desktop,
          })}
        </div>
      ) : (
        <>
          {/* Phones: cover crop. Desktop: soft blurred fill + the photo at no more than natural size. */}
          <div className={cn('absolute inset-0 md:hidden', animate && 'hero-kenburns')}>
            {img('size-full object-cover', '100vw', { objectPosition: c.mobile })}
          </div>
          <div className="absolute inset-0 hidden md:block">
            <div className="absolute inset-0 scale-110 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${photo.blur})` }} />
            <div className={cn('absolute inset-y-0 right-[6%] flex items-center', animate && 'hero-kenburns')}>
              {img('h-auto max-h-full w-auto', `${photo.width}px`, {
                maxHeight: `min(100%, ${photo.height}px)`,
                maxWidth: `${photo.width}px`,
                // Feather all four edges so a photo smaller than the hero blends into the backdrop.
                maskImage: 'linear-gradient(90deg,transparent,#000 22%,#000 85%,transparent),linear-gradient(180deg,transparent,#000 14%,#000 86%,transparent)',
                WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 22%,#000 85%,transparent),linear-gradient(180deg,transparent,#000 14%,#000 86%,transparent)',
                maskComposite: 'intersect',
                WebkitMaskComposite: 'source-in',
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
