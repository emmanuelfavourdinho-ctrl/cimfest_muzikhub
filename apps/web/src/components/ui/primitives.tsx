import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { LoaderCircle } from 'lucide-react';

/* Small presentational building blocks taken from the prototype's CSS classes. */

/** `.eyebrow` — uppercase kicker with a short signal-colour rule. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 text-label text-signal uppercase before:block before:h-0.5 before:w-5 before:bg-signal',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** `.pagehead` — eyebrow, title, description and optional actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-1.5 text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-caption leading-relaxed text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/** `.panel` — the prototype's main surface. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('overflow-hidden rounded-panel border border-hairline-strong bg-surface-raised shadow-e1', className)}
      {...props}
    />
  );
}

const pillVariants = {
  signal: 'border-control-border bg-surface-chip text-signal',
  gray: 'border-control-border bg-surface-chip text-text-2',
  gold: 'border-warning/40 bg-warning/15 text-warning',
  violet: 'border-violet/40 bg-violet/15 text-violet',
} as const;

/** `.pill` */
export function Pill({
  children,
  variant = 'signal',
  className,
}: {
  children: ReactNode;
  variant?: keyof typeof pillVariants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        pillVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** `.filterchip` as a toggle button (used for roles, genres and goals pickers). */
export function ToggleChip({ selected, className, ...props }: ComponentProps<'button'> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'min-h-10 rounded-s border px-3 text-xs transition',
        selected
          ? 'border-signal bg-signal font-bold text-on-signal'
          : 'border-control-border bg-surface-overlay text-text-2 hover:border-control-border',
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <LoaderCircle role="status" aria-label={label} className={cn('size-5 animate-spin text-signal', className)} />;
}

/** Full-area loading state used while a page's data is fetched. */
export function PageLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

/** `.hint` — left-ruled explanatory note. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-md border-l-2 border-signal bg-surface-chip px-3.5 py-3 text-xs leading-relaxed text-text-2', className)}>
      {children}
    </div>
  );
}

/** Initials avatar used until profile photo upload exists. */
export function Avatar({ name, image, className }: { name: string; image?: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  if (image) {
    // 192px square from Cloudinary; lazy because avatars repeat down long feeds.
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        width={192}
        height={192}
        className={cn('rounded-full border-2 border-control-border object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex items-center justify-center rounded-full border-2 border-control-border bg-[linear-gradient(140deg,var(--p-chip),var(--p-raised))] font-bold text-signal',
        className,
      )}
    >
      {initials || '♪'}
    </span>
  );
}

/** Honest empty state: what's missing and, when there is one, the next real step. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="px-6 py-10 text-center">
      <h2 className="text-h3 text-text-1">{title}</h2>
      {children && <p className="mx-auto mt-2 max-w-measure text-small text-text-2">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Panel>
  );
}
