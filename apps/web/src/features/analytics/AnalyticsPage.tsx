import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, PageLoading, Panel, ToggleChip } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ApiRequestError, errorMessage, request } from '@/lib/api';
import { useEntitlements } from '@/lib/billing';

const summarySchema = z.object({
  days: z.number(),
  maxDays: z.number(),
  itemAnalytics: z.boolean(),
  from: z.string(),
  to: z.string(),
  totals: z.object({ views: z.number(), plays: z.number(), clicks: z.number() }),
  series: z.array(z.object({ day: z.string(), views: z.number(), plays: z.number(), clicks: z.number() })),
});
const itemsSchema = z.object({
  items: z.array(
    z.object({
      subjectType: z.string(),
      subjectId: z.string(),
      title: z.string(),
      link: z.string().nullable(),
      plays: z.number(),
      clicks: z.number(),
    }),
  ),
});
type Summary = z.infer<typeof summarySchema>;
type Metric = 'views' | 'plays' | 'clicks';
const METRICS: { key: Metric; label: string; unit: [string, string] }[] = [
  { key: 'views', label: 'Profile views', unit: ['view', 'views'] },
  { key: 'plays', label: 'Plays', unit: ['play', 'plays'] },
  { key: 'clicks', label: 'Link clicks', unit: ['click', 'clicks'] },
];
const nf = new Intl.NumberFormat();
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** /studio/analytics — real, de-duplicated daily counts only (Creator Plus: 30 days; Pro: 365 + per item). */
export function AnalyticsPage() {
  const ent = useEntitlements();
  const [days, setDays] = useState(30);
  const summary = useQuery({
    queryKey: ['analytics', 'summary', days],
    queryFn: () => request('/analytics/summary', summarySchema, { query: { days } }),
    enabled: Boolean(ent.data?.limits.analyticsDays),
  });

  if (ent.isPending) return <PageLoading />;
  if (ent.isError) return <LoadFailed message={errorMessage(ent.error)} onRetry={() => void ent.refetch()} />;
  const max = ent.data.limits.analyticsDays;

  return (
    <div className="mx-auto max-w-content">
      <PageHeader
        eyebrow="Creator studio"
        title="Analytics"
        description="Profile views, plays of your work and clicks on your links. Counted once per listener per day; your own visits don’t count."
      />
      {!max ? (
        <EmptyState
          title="Analytics are part of Creator Plus and MuzikHub Pro"
          action={
            <Button asChild>
              <Link to="/pricing">See plans</Link>
            </Button>
          }
        >
          We only show numbers we actually recorded. Upgrade to see your daily views, plays and link clicks.
        </EmptyState>
      ) : (
        <>
          <div role="group" aria-label="Time range" className="mb-4 flex flex-wrap gap-2">
            {[7, 30, 90, 365]
              .filter((d) => d <= max)
              .map((d) => (
                <ToggleChip key={d} selected={days === d} onClick={() => setDays(d)}>
                  {d === 365 ? '1 year' : `${d} days`}
                </ToggleChip>
              ))}
          </div>
          {summary.isPending ? (
            <PageLoading />
          ) : summary.isError ? (
            <LoadFailed message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} />
          ) : (
            <Dashboard s={summary.data} />
          )}
          {ent.data.limits.itemAnalytics ? (
            <Items days={days} />
          ) : (
            <p className="mt-6 text-small text-text-2">
              Per-item analytics (plays and clicks for each work, post and link) are part of{' '}
              <Link to="/pricing" className="text-signal underline">
                MuzikHub Pro
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Dashboard({ s }: { s: Summary }) {
  const empty = s.totals.views + s.totals.plays + s.totals.clicks === 0;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {METRICS.map((m) => (
          <Panel key={m.key} className="p-4">
            <p className="text-caption text-text-2">{m.label}</p>
            <p className="mt-1 text-h2 text-text-1">{nf.format(s.totals[m.key])}</p>
            <p className="text-caption text-text-3">
              {dayLabel(s.from)} – {dayLabel(s.to)}
            </p>
          </Panel>
        ))}
      </div>
      {empty ? (
        <p className="mt-4 text-small text-text-2">
          Nothing recorded in this period yet. Share your profile and work to get your first listeners.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {METRICS.map((m) => (
            <DailyBars key={m.key} title={m.label} unit={m.unit} data={s.series.map((d) => ({ day: d.day, value: d[m.key] }))} />
          ))}
        </div>
      )}
      <details className="mt-4 rounded-panel border border-hairline-strong bg-surface-raised p-4 text-small">
        <summary className="cursor-pointer text-text-1">Show as a table</summary>
        <div role="region" aria-label="Daily analytics table" tabIndex={0} className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-left [&_td]:py-1 [&_th]:py-1">
            <thead>
              <tr className="text-text-2">
                <th scope="col">Day</th>
                {METRICS.map((m) => (
                  <th key={m.key} scope="col" className="text-right">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...s.series].reverse().map((d) => (
                <tr key={d.day} className="text-text-1">
                  <th scope="row" className="font-normal text-text-2">
                    {dayLabel(d.day)}
                  </th>
                  <td className="text-right tabular-nums">{nf.format(d.views)}</td>
                  <td className="text-right tabular-nums">{nf.format(d.plays)}</td>
                  <td className="text-right tabular-nums">{nf.format(d.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/**
 * One metric over time: thin single-hue columns from one baseline, rounded data ends, 2px gaps,
 * recessive axis, hover/focus tooltip. One chart per metric (never two scales on one axis).
 */
function DailyBars({ title, unit, data }: { title: string; unit: [string, string]; data: { day: string; value: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 300;
  const H = 120;
  const top = Math.max(1, ...data.map((d) => d.value));
  const slot = W / data.length;
  const bar = Math.max(1, Math.min(24, slot - 2));
  const r = Math.min(4, bar / 2);
  const total = data.reduce((t, d) => t + d.value, 0);
  const shown = active != null ? data[active]! : null;
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-small font-semibold text-text-1">{title}</h3>
        <p className="text-caption text-text-2" aria-live="polite">
          {shown
            ? `${dayLabel(shown.day)}: ${nf.format(shown.value)} ${shown.value === 1 ? unit[0] : unit[1]}`
            : total === 0
              ? 'None in this period'
              : `Peak ${nf.format(top)} a day`}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 1}`}
        className="mt-2 h-32 w-full"
        role="img"
        aria-label={`${title}: ${nf.format(total)} over ${data.length} days. Use the table for daily values.`}
        preserveAspectRatio="none"
      >
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-hairline-strong" strokeWidth="1" />
        {data.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(2, (d.value / top) * (H - 4));
          const x = i * slot + (slot - bar) / 2;
          const y = H - h;
          return (
            <g key={d.day} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive((a) => (a === i ? null : a))}>
              {/* Hit target: the whole column slot, bigger than the mark. */}
              <rect x={i * slot} y="0" width={slot} height={H} className="fill-transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${H} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${H} Z`}
                  className={active === i ? 'fill-signal-hover' : 'fill-signal'}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-caption text-text-3">
        <span>{dayLabel(data[0]!.day)}</span>
        <span>{dayLabel(data.at(-1)!.day)}</span>
      </div>
    </Panel>
  );
}

function Items({ days }: { days: number }) {
  const q = useQuery({
    queryKey: ['analytics', 'items', days],
    queryFn: () => request('/analytics/items', itemsSchema, { query: { days } }),
  });
  return (
    <section aria-labelledby="per-item" className="mt-6">
      <h2 id="per-item" className="mb-2 text-h3">
        Per item
      </h2>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        q.error instanceof ApiRequestError && q.error.status === 403 ? null : (
          <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )
      ) : q.data.items.length === 0 ? (
        <p className="text-small text-text-2">No plays or clicks on individual items in this period yet.</p>
      ) : (
        <div
          role="region"
          aria-label="Per-item analytics"
          tabIndex={0}
          className="overflow-x-auto rounded-panel border border-hairline-strong bg-surface-raised"
        >
          <table className="w-full min-w-120 text-left text-small [&_td]:border-t [&_td]:border-hairline-strong [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
            <thead>
              <tr className="text-text-2">
                <th scope="col">Item</th>
                <th scope="col">Type</th>
                <th scope="col" className="text-right">
                  Plays
                </th>
                <th scope="col" className="text-right">
                  Link clicks
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={`${i.subjectType}:${i.subjectId}`}>
                  <td className="text-text-1">
                    {i.link ? (
                      <Link to={i.link} className="hover:text-signal">
                        {i.title}
                      </Link>
                    ) : (
                      i.title
                    )}
                  </td>
                  <td className="text-text-2">
                    {{ PORTFOLIO_ITEM: 'Work', POST: 'Post', PROFILE_LINK: 'Profile link' }[i.subjectType] ?? i.subjectType}
                  </td>
                  <td className="text-right tabular-nums">{nf.format(i.plays)}</td>
                  <td className="text-right tabular-nums">{nf.format(i.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
