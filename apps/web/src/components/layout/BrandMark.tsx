import { Link } from 'react-router';

/** Prototype `.brand`: the "∿M" wave mark + Muzik<b>Hub</b> wordmark. */
export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.04em] sm:text-xl" aria-label="MuzikHub home">
      <span aria-hidden className="inline-flex -rotate-[5deg] pr-1 text-[27px] font-black tracking-[-0.18em] text-emerald">
        ∿M
      </span>
      <span>
        Muzik<b className="text-emerald">Hub</b>
      </span>
    </Link>
  );
}
