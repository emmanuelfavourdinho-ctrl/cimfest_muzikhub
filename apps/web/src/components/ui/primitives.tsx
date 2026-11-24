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
        <h1 className="mt-1.5 text-[27px] leading-tight font-bold tracking-tight sm:text-[33px]">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-sage">{description}</p>}
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
  emerald: 'border-[#24644b] bg-[#134130] text-[#87eabb]',
  gray: 'border-[#365b45] bg-[#20352b] text-[#bdd0c6]',
  gold: 'border-[#7a692d] bg-[#443817] text-[#ffdc81]',
  violet: 'border-[#71447c] bg-[#392444] text-[#deb5ff]',
} as const;

/** `.pill` */
export function Pill({
  children,
  variant = 'emerald',
  className,
}: {
  children: ReactNode;
  variant?: keyof typeof pillVariants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
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
        'min-h-10 rounded-[9px] border px-3 text-xs transition',
        selected
          ? 'border-[#33eba5] bg-[#34e6a5] font-bold text-[#062819]'
          : 'border-[#2a5744] bg-[#0e2c22] text-[#a8cdbb] hover:border-[#3a7f60]',
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <LoaderCircle role="status" aria-label={label} className={cn('size-5 animate-spin text-mint', className)} />;
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
    <div
      className={cn('rounded-md border-l-2 border-[#2beca1] bg-[#163c2f] px-3.5 py-3 text-xs leading-relaxed text-[#b1d4c1]', className)}
    >
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
        className={cn('rounded-full border-2 border-[#37694e] object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex items-center justify-center rounded-full border-2 border-[#37694e] bg-[linear-gradient(140deg,#123f2e,#0d291f)] font-bold text-mint',
        className,
      )}
    >
      {initials || '♪'}
    </span>
  );
}
