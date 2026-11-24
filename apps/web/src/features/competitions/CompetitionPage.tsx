import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Medal } from 'lucide-react';
import { toast } from 'sonner';
import { COMPETITION_CATEGORIES, ENTRY_FORMATS, type CompetitionDetail, type MediaView } from '@muzikhub/shared';
import { MediaBlock } from '@/components/media/Media';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { Avatar, Eyebrow, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ReportButton } from '@/features/feed/ReportButton';
import { errorMessage } from '@/lib/api';
import { compApi, compKeys, formatWhen } from '@/lib/competitions';
import { useMe } from '@/lib/queries';
import { closingOf, PhasePill } from './ui';

/** /competitions/:slug — everything an entrant must know before entering (COMP-008), then enter, then results. */
export function CompetitionPage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: compKeys.detail(slug), queryFn: () => compApi.detail(slug) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Competition c={q.data} />;
}

function Terms({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold tracking-wide text-text-3 uppercase">{label}</dt>
      <dd className="mt-0.5 text-small whitespace-pre-line text-text-1">{children}</dd>
    </div>
  );
}

function Competition({ c }: { c: CompetitionDetail }) {
  const { data: me } = useMe();
  return (
    <article className="mx-auto max-w-content">
      {c.cover && (
        <div className="mb-4 h-36 overflow-hidden rounded-panel border border-hairline-strong sm:h-52">
          <img src={c.cover} alt="" className="size-full object-cover" />
        </div>
      )}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PhasePill phase={c.phase} />
            <Eyebrow>{COMPETITION_CATEGORIES[c.category]}</Eyebrow>
          </div>
          <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight break-words sm:text-3xl">{c.title}</h1>
          <p className="mt-2 text-caption text-text-2">
            Organised by{' '}
            <Link to={`/u/${c.organiser.username}`} className="font-semibold text-text-1 hover:text-signal">
              {c.organiser.name}
            </Link>{' '}
            · {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        {me && !c.viewer.isOrganiser && <ReportButton targetType="COMPETITION" targetId={c.id} compact />}
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_--spacing(88)]">
        <div className="min-w-0 space-y-5">
          {c.phase === 'CANCELLED' && <Panel className="border-danger/40 p-4 text-small text-text-1">Cancelled: {c.cancelReason}</Panel>}
          {c.results.length > 0 && <Results c={c} />}
          <p className="text-body whitespace-pre-line text-text-1">{c.description}</p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Terms label="Prize">
              {c.prize}
              <span className="mt-1 block text-caption text-text-3">
                Offered by the organiser for the top {c.prizePlaces} {c.prizePlaces === 1 ? 'place' : 'places'}. MuzikHub doesn’t provide or
                guarantee prizes.
              </span>
            </Terms>
            <Terms label="Who can enter">{c.eligibility}</Terms>
            <Terms label="How it’s judged">
              {c.judgingMethod}
              <span className="mt-1 block text-caption text-text-2">
                Criteria: {c.criteria.map((cr) => `${cr.name} (${cr.weight}%)`).join(', ')}. Ties go to the earlier entry.
              </span>
            </Terms>
            <Terms label="Accepted entries">{c.formats.map((f) => ENTRY_FORMATS[f]).join(', ')}</Terms>
            <Terms label="Disqualification">{c.disqualification}</Terms>
            <Terms label="Disputes">{c.disputeProcess}</Terms>
          </dl>
          <section aria-labelledby="rules">
            <h2 id="rules" className="text-h3">
              Rules <span className="text-caption font-normal text-text-3">version {c.rulesVersion}</span>
            </h2>
            <p className="mt-1 text-small whitespace-pre-line text-text-1">{c.rules}</p>
          </section>
        </div>

        <aside className="space-y-4">
          <Panel className="p-4">
            <dl className="space-y-2 text-small">
              <div>
                <dt className="text-text-2">Entries open</dt>
                <dd className="font-semibold">{formatWhen(c.opensAt)}</dd>
              </div>
              <div>
                <dt className="text-text-2">Entries close</dt>
                <dd className="font-semibold">{formatWhen(closingOf(c))}</dd>
                {c.extensionReason && <dd className="text-caption text-text-3">Extended: {c.extensionReason}</dd>}
              </div>
            </dl>
          </Panel>
          {c.viewer.isOrganiser ? <OrganiserTools c={c} /> : <EntryPanel c={c} />}
          {c.judges.length > 0 && (
            <Panel className="p-4">
              <h2 className="text-small font-semibold">Judges</h2>
              <ul className="mt-2 space-y-2">
                {c.judges.map((j) => (
                  <li key={j.username}>
                    <Link to={`/u/${j.username}`} className="flex items-center gap-2 text-small hover:text-signal">
                      <Avatar name={j.name} image={j.image} className="size-7 text-xs" /> {j.name}
                    </Link>
                  </li>
                ))}
              </ul>
              {c.viewer.isJudge && (
                <Button asChild size="sm" className="mt-3 w-full">
                  <Link to={`/competitions/${c.slug}/judging`}>Go to judging</Link>
                </Button>
              )}
            </Panel>
          )}
        </aside>
      </div>
    </article>
  );
}

function Results({ c }: { c: CompetitionDetail }) {
  return (
    <section aria-labelledby="results" className="rounded-panel border border-control-border bg-surface-raised p-4">
      <h2 id="results" className="flex items-center gap-2 text-h3">
        <Medal aria-hidden className="size-5 text-signal" /> Results
      </h2>
      <p className="text-caption text-text-3">
        Published {c.resultsPublishedAt && formatWhen(c.resultsPublishedAt)} · average judges’ score out of 100
      </p>
      <ol className="mt-3 space-y-3">
        {c.results.map((r) => (
          <li key={r.placement} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-chip font-bold text-signal">
              #{r.placement}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.entry.title}</p>
              <p className="text-caption text-text-2">
                <Link to={`/u/${r.entry.participant.username}`} className="hover:text-signal">
                  {r.entry.participant.name}
                </Link>{' '}
                · {r.averageScore}
              </p>
              {r.entry.media ? (
                <div className="mt-2">
                  <MediaBlock media={r.entry.media as MediaView} title={r.entry.title} />
                </div>
              ) : r.entry.externalUrl ? (
                <a
                  href={r.entry.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 inline-flex min-h-11 items-center text-caption text-signal underline-offset-2 hover:underline"
                >
                  Listen or watch
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EntryPanel({ c }: { c: CompetitionDetail }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: compKeys.entry(c.slug), queryFn: () => compApi.myEntry(c.slug), enabled: Boolean(c.viewer.entryId) });
  const [editing, setEditing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['competitions'] });

  if (!me) {
    return (
      <Panel className="p-4">
        <Button asChild className="w-full">
          <Link to={`/login?next=${encodeURIComponent(`/competitions/${c.slug}`)}`}>Sign in to enter</Link>
        </Button>
      </Panel>
    );
  }
  const e = mine.data;
  return (
    <Panel className="space-y-3 p-4">
      <h2 className="text-small font-semibold">Your entry</h2>
      {e ? (
        <>
          <p className="text-small">
            <strong>{e.title}</strong>
            <span className="block text-caption text-text-2">
              {e.status === 'DISQUALIFIED'
                ? `Disqualified: ${e.disqualifiedReason}`
                : `Submitted ${formatWhen(e.submittedAt)} · rules v${e.rulesVersion}`}
            </span>
          </p>
          {e.judgements.length > 0 && (
            <div className="space-y-2 border-t border-hairline-strong pt-3">
              <h3 className="text-caption font-semibold text-text-2">Judges’ scores</h3>
              {e.judgements.map((j, i) => (
                <div key={i} className="text-caption text-text-1">
                  <p>
                    {Object.entries(j.scores)
                      .map(([k, v]) => `${k} ${v}/10`)
                      .join(' · ')}{' '}
                    → <strong>{j.total}</strong>
                  </p>
                  {j.feedback && <p className="text-text-2">“{j.feedback}”</p>}
                </div>
              ))}
            </div>
          )}
          {c.viewer.canEnter && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Update entry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await compApi.withdraw(c.slug);
                    await refresh();
                    toast.success('Entry withdrawn');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Withdraw
              </Button>
            </div>
          )}
          {c.viewer.canDispute && (
            <Button size="sm" variant="ghost" onClick={() => setDisputing(true)}>
              Dispute the results
            </Button>
          )}
          {c.viewer.disputeStatus && (
            <p className="text-caption text-text-2">
              Your dispute: {c.viewer.disputeStatus === 'OPEN' ? 'being reviewed by MuzikHub staff' : c.viewer.disputeStatus.toLowerCase()}
            </p>
          )}
        </>
      ) : c.viewer.canEnter ? (
        <Button className="w-full" onClick={() => setEditing(true)}>
          Enter this competition
        </Button>
      ) : (
        <p className="text-small text-text-2">{c.viewer.cannotEnterReason}</p>
      )}
      {editing && <EntryForm c={c} onClose={() => setEditing(false)} />}
      <Dialog open={disputing} onClose={() => setDisputing(false)} title="Dispute the results">
        <p className="mb-3 text-sm text-text-2">MuzikHub staff review disputes and record a decision. One dispute per entrant.</p>
        <Field label="What went wrong?">
          {(a) => <Textarea {...a} rows={4} value={reason} maxLength={2000} onChange={(ev) => setReason(ev.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDisputing(false)}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 20}
            onClick={async () => {
              try {
                await compApi.dispute(c.slug, reason.trim());
                await refresh();
                setDisputing(false);
                toast.success('Dispute sent');
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Send dispute
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}

function EntryForm({ c, onClose }: { c: CompetitionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [media, setMedia] = useState<MediaView | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadKinds = c.formats.filter((f) => f !== 'LINK') as ('AUDIO' | 'VIDEO' | 'IMAGE')[];
  return (
    <Dialog open onClose={onClose} title={`Enter “${c.title}”`}>
      <div className="space-y-3">
        <Field label="Title of your entry">
          {(a) => <Input {...a} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        {uploadKinds.length > 0 && (
          <MediaUploader
            purpose="COMPETITION"
            kinds={uploadKinds}
            value={media}
            onChange={setMedia}
            label="Upload your work"
            onBusyChange={setUploading}
          />
        )}
        {c.formats.includes('LINK') && (
          <Field label={uploadKinds.length ? '…or a link (https)' : 'Link to your work (https)'}>
            {(a) => <Input {...a} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />}
          </Field>
        )}
        <Field label="Notes for the judges (optional)">
          {(a) => <Textarea {...a} rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <label className="flex items-start gap-2 text-small">
          <input type="checkbox" className="mt-1 accent-signal" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>I’ve read and accept the rules (version {c.rulesVersion}), the eligibility, disqualification and dispute terms.</span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!accepted || busy || uploading || title.trim().length < 2 || (!media && !link.trim())}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await compApi.enter(c.slug, {
                  title: title.trim(),
                  ...(description.trim() && { description: description.trim() }),
                  ...(media ? { mediaId: media.id } : { externalUrl: link.trim() }),
                  acceptedRulesVersion: c.rulesVersion,
                });
                await qc.invalidateQueries({ queryKey: ['competitions'] });
                toast.success('Entry received');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Submitting…' : 'Submit entry'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function OrganiserTools({ c }: { c: CompetitionDetail }) {
  const qc = useQueryClient();
  const [judge, setJudge] = useState('');
  const [dialog, setDialog] = useState<null | 'extend' | 'cancel'>(null);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };
  const live = c.phase !== 'RESULTS' && c.phase !== 'CANCELLED';
  return (
    <Panel className="space-y-3 p-4">
      <h2 className="text-small font-semibold">You organise this</h2>
      <div className="flex flex-col gap-2">
        {c.phase === 'DRAFT' && <Button onClick={() => void run(() => compApi.publish(c.slug), 'Published')}>Publish</Button>}
        {live && (
          <Button asChild variant="outline">
            <Link to={`/competitions/${c.slug}/edit`}>Edit details</Link>
          </Button>
        )}
        {(c.phase === 'OPEN' || c.phase === 'JUDGING') && (
          <Button asChild>
            <Link to={`/competitions/${c.slug}/judging`}>{c.phase === 'JUDGING' ? 'Judge and publish results' : 'See entries'}</Link>
          </Button>
        )}
        {(c.phase === 'OPEN' || c.phase === 'JUDGING' || c.phase === 'UPCOMING') && (
          <Button variant="outline" onClick={() => setDialog('extend')}>
            Extend the deadline
          </Button>
        )}
        {live && (
          <Button variant="ghost" onClick={() => setDialog('cancel')}>
            Cancel competition
          </Button>
        )}
      </div>
      {live && (
        <form
          className="flex items-end gap-2 border-t border-hairline-strong pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (judge.trim() && (await run(() => compApi.addJudge(c.slug, judge.trim().replace(/^@/, '')), 'Judge added'))) setJudge('');
          }}
        >
          <Field label="Add a judge by username" className="mb-0 min-w-0 flex-1">
            {(a) => <Input {...a} value={judge} onChange={(e) => setJudge(e.target.value)} placeholder="@username" />}
          </Field>
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </form>
      )}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'extend' ? 'Extend the deadline' : 'Cancel the competition'}
      >
        {dialog === 'extend' && (
          <Field label="New closing time">
            {(a) => <Input {...a} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
          </Field>
        )}
        <Field label={dialog === 'extend' ? 'Reason (shown to entrants and recorded)' : 'Reason (shown to entrants)'}>
          {(a) => <Textarea {...a} rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDialog(null)}>
            Back
          </Button>
          <Button
            variant={dialog === 'cancel' ? 'destructive' : 'primary'}
            disabled={reason.trim().length < 5 || (dialog === 'extend' && !until)}
            onClick={async () => {
              const ok =
                dialog === 'extend'
                  ? await run(() => compApi.extend(c.slug, new Date(until).toISOString(), reason.trim()), 'Deadline extended')
                  : await run(() => compApi.cancel(c.slug, reason.trim()), 'Competition cancelled');
              if (ok) {
                setDialog(null);
                setReason('');
              }
            }}
          >
            {dialog === 'extend' ? 'Extend' : 'Cancel competition'}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
