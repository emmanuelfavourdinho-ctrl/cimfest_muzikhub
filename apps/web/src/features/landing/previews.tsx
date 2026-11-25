import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Check, Heart, MapPin, MessageCircle, Pause, Play, Search, Upload, UserPlus } from 'lucide-react';
import { sample } from './content';
import { useOnScreen } from './hooks';

/*
 * Illustrative UI fragments for the landing page, drawn with the real design tokens.
 * They are pictures, not controls: each preview is one role="img" with a text alternative,
 * everything inside is aria-hidden, and nothing is a button or link.
 */

export function Preview({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="img" aria-label={label} className={className}>
      <div aria-hidden className="contents">
        {children}
      </div>
    </div>
  );
}

export function PreviewTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-hairline-strong bg-surface-base px-2.5 py-1 text-caption font-semibold text-text-2">
      {children}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-surface-chip font-extrabold text-signal', className)}>
      {initials(name)}
    </span>
  );
}

export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center rounded-full px-3.5 text-small font-semibold whitespace-nowrap',
        active ? 'bg-signal text-on-signal' : 'bg-surface-chip text-text-1',
      )}
    >
      {children}
    </span>
  );
}

/** Original abstract artwork for portfolio tiles: palette-only gradients, no images. */
const ART = [
  'bg-[conic-gradient(from_210deg_at_30%_70%,var(--p-accent),var(--p-chip)_35%,var(--p-overlay)_70%,var(--p-accent))]',
  'bg-[radial-gradient(circle_at_70%_30%,var(--p-accent-hover),transparent_45%),linear-gradient(160deg,var(--p-control),var(--p-raised))]',
  'bg-[repeating-linear-gradient(115deg,var(--p-chip)_0_10px,var(--p-overlay)_10px_20px)]',
] as const;

export function ArtTile({ variant = 0, className }: { variant?: 0 | 1 | 2; className?: string }) {
  return <span className={cn('block rounded-m', ART[variant], className)} />;
}

/** The circular progress dial from the player, with a play/pause glyph in the middle. */
export function Dial({ size = 'md', playing = true }: { size?: 'md' | 'lg'; playing?: boolean }) {
  const [ref, onScreen] = useOnScreen<HTMLSpanElement>();
  const r = 20;
  const length = 2 * Math.PI * r;
  return (
    <span
      ref={ref}
      data-playing={String(playing && onScreen)}
      className={cn('relative flex shrink-0 items-center justify-center', size === 'lg' ? 'size-32' : 'size-14')}
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--p-line-strong)" strokeWidth="2.5" />
        <circle
          className="dial-progress"
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="var(--p-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={length}
          style={{ ['--dial-length' as string]: String(length) }}
        />
      </svg>
      <span className={cn('flex items-center justify-center rounded-full bg-signal text-on-signal', size === 'lg' ? 'size-16' : 'size-9')}>
        {playing ? <Pause className={size === 'lg' ? 'size-7' : 'size-4'} fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
      </span>
    </span>
  );
}

export function ProfileCardPreview({ person = sample.creator, compact = false }: { person?: { name: string; handle: string; roles: string[]; genres?: string[]; location?: string }; compact?: boolean }) {
  return (
    <div className="rounded-media border border-hairline-strong bg-surface-raised p-5 shadow-e2">
      <div className="flex items-center gap-3">
        <Monogram name={person.name} className={compact ? 'size-11 text-small' : 'size-14 text-body'} />
        <div className="min-w-0">
          <p className="truncate text-body font-bold text-text-1">{person.name}</p>
          <p className="truncate text-small text-text-3">@{person.handle}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {person.roles.map((r, i) => (
          <Chip key={r} active={i === 0}>
            {r}
          </Chip>
        ))}
      </div>
      {!compact && person.genres && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-2">
          <span>{person.genres.join(' · ')}</span>
          {person.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {person.location}
            </span>
          )}
        </p>
      )}
      {!compact && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ArtTile variant={0} className="aspect-square" />
          <ArtTile variant={1} className="aspect-square" />
          <ArtTile variant={2} className="aspect-square" />
        </div>
      )}
    </div>
  );
}

export function TrackRowPreview() {
  const t = sample.track;
  return (
    <div className="flex items-center gap-4 rounded-media border border-hairline-strong bg-surface-overlay p-4 shadow-e3">
      <Dial />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-bold text-text-1">{t.title}</p>
        <p className="truncate text-small text-text-2">
          {sample.creator.name} · {t.kind}
        </p>
        <div className="mt-2 flex items-center gap-2 text-caption text-text-2 tabular-nums">
          <span>{t.elapsed}</span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-chip">
            <span className="block h-full w-2/5 rounded-full bg-signal" />
          </span>
          <span>{t.length}</span>
        </div>
      </div>
    </div>
  );
}

export function RoleChipsPreview({ active = 'Producer' }: { active?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sample.roleChips.map((r) => (
        <Chip key={r} active={r === active}>
          {r}
        </Chip>
      ))}
    </div>
  );
}

/* ── Small fragments for "How it works" ── */

export function UploadFragment() {
  return (
    <div className="flex items-center gap-3 rounded-m border border-hairline-strong bg-surface-raised p-3">
      <span className="flex size-9 items-center justify-center rounded-full bg-surface-chip text-signal">
        <Upload className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-semibold text-text-1">{sample.track.title}.wav</p>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-chip">
          <span className="block h-full w-full rounded-full bg-signal" />
        </span>
      </div>
      <Check className="size-4 text-signal" />
    </div>
  );
}

export function SearchFragment() {
  return (
    <div className="space-y-2">
      <div className="flex h-10 items-center gap-2 rounded-full border border-control-border bg-surface-base px-3.5 text-small text-text-2">
        <Search className="size-4" /> Producers in Douala
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip active>Producer</Chip>
        <Chip>Afrobeats</Chip>
      </div>
    </div>
  );
}

export function ConnectFragment() {
  const p = sample.second;
  return (
    <div className="flex items-center gap-3 rounded-m border border-hairline-strong bg-surface-raised p-3">
      <Monogram name={p.name} className="size-9 text-caption" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-semibold text-text-1">{p.name}</p>
        <p className="truncate text-caption text-text-3">{p.roles[0]}</p>
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-on-signal">
        <UserPlus className="size-4" />
      </span>
    </div>
  );
}

/* ── Fragments for "Features" ── */

export function DiscoverFragment() {
  const people = [sample.creator, sample.second, sample.third];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip active>All roles</Chip>
        <Chip>Producer</Chip>
        <Chip>DJ</Chip>
        <Chip>Engineer</Chip>
      </div>
      <ul className="divide-y divide-hairline rounded-m border border-hairline-strong bg-surface-raised">
        {people.map((p) => (
          <li key={p.handle} className="flex items-center gap-3 px-3 py-2.5">
            <Monogram name={p.name} className="size-8 text-caption" />
            <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-1">{p.name}</span>
            <span className="truncate text-caption text-text-2">{p.roles[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeedFragment() {
  const p = sample.third;
  return (
    <div className="rounded-m border border-hairline-strong bg-surface-raised p-4">
      <div className="flex items-center gap-3">
        <Monogram name={p.name} className="size-9 text-caption" />
        <div className="min-w-0">
          <p className="truncate text-small font-semibold text-text-1">{p.name}</p>
          <p className="truncate text-caption text-text-3">{p.roles.join(' · ')}</p>
        </div>
      </div>
      <p className="mt-3 text-small text-text-2">New mix is up on my profile — recorded live last weekend.</p>
      <div className="mt-3 flex gap-4 text-caption text-text-2">
        <span className="inline-flex items-center gap-1.5">
          <Heart className="size-4" /> Like
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="size-4" /> Comment
        </span>
      </div>
    </div>
  );
}
