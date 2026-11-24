import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { SCORE_MAX, type EntryView, type MediaView } from '@muzikhub/shared';
import { MediaBlock } from '@/components/media/Media';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel, Pill } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { compApi, compKeys, formatWhen } from '@/lib/competitions';
import { useMe } from '@/lib/queries';

/** /competitions/:slug/judging — organiser and assigned judges score each entry on the published criteria. */
export function JudgingPage() {
  const { slug = '' } = useParams();
  const detail = useQuery({ queryKey: compKeys.detail(slug), queryFn: () => compApi.detail(slug) });
  const entries = useQuery({ queryKey: compKeys.entries(slug), queryFn: () => compApi.entries(slug), retry: false });
  const qc = useQueryClient();
  if (detail.isPending || entries.isPending) return <PageLoading />;
  if (detail.isError) return <LoadFailed message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  if (entries.isError) return <LoadFailed message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />;
  const c = detail.data;
  const { items, criteria, phase } = entries.data;
  const judging = phase === 'JUDGING';
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/competitions/${slug}`} className="mb-3 inline-flex items-center gap-1 text-caption text-text-2 hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {c.title}
      </Link>
      <PageHeader
        eyebrow="Judging"
        title={`${items.length} ${items.length === 1 ? 'entry' : 'entries'}`}
        description={
          judging
            ? `Score every entry on each criterion (0–${SCORE_MAX}). Scores can change until results are published.`
            : phase === 'RESULTS'
              ? 'Results are published; scores are final.'
              : 'Entries are still open. Scoring starts when they close.'
        }
        actions={
          c.viewer.isOrganiser && judging ? (
            <Button
              onClick={async () => {
                try {
                  await compApi.results(slug);
                  await qc.invalidateQueries({ queryKey: ['competitions'] });
                  toast.success('Results published');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Publish results
            </Button>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState title="No entries">Nothing to judge yet.</EmptyState>
      ) : (
        <ol className="space-y-4">
          {items.map((e) => (
            <li key={e.id}>
              <EntryCard
                e={e}
                criteria={criteria}
                slug={slug}
                canScore={judging && e.status === 'SUBMITTED'}
                isOrganiser={c.viewer.isOrganiser}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EntryCard({
  e,
  criteria,
  slug,
  canScore,
  isOrganiser,
}: {
  e: EntryView;
  criteria: { name: string; weight: number }[];
  slug: string;
  canScore: boolean;
  isOrganiser: boolean;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const mine = e.judgements.find((j) => j.judge?.username === me?.profile?.username);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(criteria.map((c) => [c.name, (mine?.scores[c.name] as number | undefined) ?? 0])),
  );
  const [feedback, setFeedback] = useState(mine?.feedback ?? '');
  const [disq, setDisq] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: compKeys.entries(slug) });
  return (
    <Panel className="p-4" aria-label={`Entry: ${e.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{e.title}</h2>
        {e.status === 'DISQUALIFIED' && <Pill variant="gray">Disqualified</Pill>}
        {e.averageScore !== null && <span className="text-caption text-text-2">Average {e.averageScore}</span>}
      </div>
      <p className="text-caption text-text-2">
        by {e.participant.name} · {formatWhen(e.submittedAt)} · rules v{e.rulesVersion}
      </p>
      {e.description && <p className="mt-2 text-small whitespace-pre-line text-text-1">{e.description}</p>}
      <div className="mt-2">
        {e.media ? (
          <MediaBlock media={e.media as MediaView} title={e.title} />
        ) : e.externalUrl ? (
          <a
            href={e.externalUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-11 items-center text-small break-all text-signal underline-offset-2 hover:underline"
          >
            {e.externalUrl}
          </a>
        ) : null}
      </div>
      {isOrganiser && e.judgements.length > 0 && (
        <ul className="mt-3 space-y-1 text-caption text-text-2">
          {e.judgements.map((j, i) => (
            <li key={i}>
              {j.judge?.name ?? 'Judge'}: {j.total}
              {j.feedback && ` — “${j.feedback}”`}
            </li>
          ))}
        </ul>
      )}
      {canScore && (
        <form
          className="mt-4 border-t border-hairline-strong pt-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            try {
              await compApi.score(e.id, scores, feedback.trim() || undefined);
              await refresh();
              toast.success('Score saved');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {criteria.map((c) => (
              <Field key={c.name} label={`${c.name} (${c.weight}%)`}>
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={0}
                    max={SCORE_MAX}
                    value={scores[c.name] ?? 0}
                    onChange={(ev) => setScores((s) => ({ ...s, [c.name]: Math.max(0, Math.min(SCORE_MAX, Number(ev.target.value))) }))}
                  />
                )}
              </Field>
            ))}
          </div>
          <Field label="Feedback for the entrant (shown after results)">
            {(a) => <Textarea {...a} rows={2} value={feedback} maxLength={2000} onChange={(ev) => setFeedback(ev.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">
              Save score
            </Button>
            {isOrganiser && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setDisq(true)}>
                Disqualify
              </Button>
            )}
          </div>
        </form>
      )}
      <Dialog open={disq} onClose={() => setDisq(false)} title={`Disqualify “${e.title}”?`}>
        <Field label="Reason (shown to the entrant, recorded)">
          {(a) => <Textarea {...a} rows={3} value={reason} maxLength={500} onChange={(ev) => setReason(ev.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDisq(false)}>
            Back
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 5}
            onClick={async () => {
              try {
                await compApi.disqualify(e.id, reason.trim());
                await refresh();
                setDisq(false);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Disqualify
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
