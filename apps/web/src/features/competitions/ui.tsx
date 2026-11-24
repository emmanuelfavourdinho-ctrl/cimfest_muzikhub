import { Link } from 'react-router';
import { CalendarClock } from 'lucide-react';
import { COMPETITION_CATEGORIES, PHASE_LABELS, type CompetitionCard, type CompetitionPhase } from '@muzikhub/shared';
import { Pill } from '@/components/ui/primitives';
import { formatWhen } from '@/lib/competitions';

const TONE: Record<CompetitionPhase, 'signal' | 'gray' | 'gold' | 'violet'> = {
  DRAFT: 'gray',
  UPCOMING: 'violet',
  OPEN: 'signal',
  JUDGING: 'gold',
  RESULTS: 'gray',
  CANCELLED: 'gray',
};
export const PhasePill = ({ phase }: { phase: CompetitionPhase }) => <Pill variant={TONE[phase]}>{PHASE_LABELS[phase]}</Pill>;

export function closingOf(c: Pick<CompetitionCard, 'closesAt' | 'extendedUntil'>) {
  return c.extendedUntil ?? c.closesAt;
}

/** One competition in a list: what it is, when, and what's at stake. */
export function CompetitionRow({ c }: { c: CompetitionCard }) {
  const when = c.phase === 'UPCOMING' ? `Opens ${formatWhen(c.opensAt)}` : c.phase === 'OPEN' ? `Closes ${formatWhen(closingOf(c))}` : null;
  return (
    <li className="flex gap-4 border-b border-hairline-strong py-4 last:border-b-0">
      <div aria-hidden className="hidden size-20 shrink-0 overflow-hidden rounded-s bg-surface-overlay sm:block">
        {c.cover ? (
          <img src={c.cover} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <span className="flex size-full items-center justify-center text-h2 text-signal">{c.title.charAt(0)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <PhasePill phase={c.phase} />
          <span className="text-caption text-text-2">{COMPETITION_CATEGORIES[c.category]}</span>
        </div>
        <h3 className="mt-1 text-body font-semibold">
          <Link to={`/competitions/${c.slug}`} className="hover:text-signal">
            {c.title}
          </Link>
        </h3>
        <p className="mt-0.5 line-clamp-1 text-small text-text-2">Prize: {c.prize}</p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-3">
          {when && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock aria-hidden className="size-3.5" /> {when}
            </span>
          )}
          <span>
            {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
          </span>
          <span>by {c.organiser.name}</span>
        </p>
      </div>
    </li>
  );
}
