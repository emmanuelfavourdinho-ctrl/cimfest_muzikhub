import { Link } from 'react-router';

/** The "∿M" wave mark + Muzik<b>Hub</b> wordmark. */
export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex min-h-11 items-center gap-2.5 text-xl font-extrabold tracking-tight">
      <span aria-hidden className="inline-flex -rotate-6 pr-1 text-[1.6875rem] font-black tracking-[-0.18em] text-signal">
        ∿M
      </span>
      <span>
        Muzik<b className="text-signal">Hub</b>
      </span>
      {/* Visible text stays the start of the accessible name ("MuzikHub home"), per WCAG 2.5.3. */}
      <span className="sr-only"> home</span>
    </Link>
  );
}
