import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  COMPETITION_CATEGORIES,
  COMPETITION_CATEGORY_KEYS,
  competitionInputSchema,
  ENTRY_FORMAT_KEYS,
  ENTRY_FORMATS,
  type CompetitionCategory,
  type CompetitionDetail,
  type EntryFormat,
  type MediaView,
} from '@muzikhub/shared';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { compApi, compKeys } from '@/lib/competitions';

/** datetime-local value in the viewer's time zone. */
const local = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** /competitions/new and /competitions/:slug/edit */
export function CompetitionEditorPage() {
  const { slug } = useParams();
  const existing = useQuery({ queryKey: compKeys.detail(slug ?? ''), queryFn: () => compApi.detail(slug!), enabled: Boolean(slug) });
  if (slug && existing.isPending) return <PageLoading />;
  if (slug && existing.isError) return <LoadFailed message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} />;
  if (existing.data && !existing.data.viewer.isOrganiser) return <EmptyState title="Only the organiser can edit this competition" />;
  return <Editor existing={existing.data ?? null} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel className="space-y-4 p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </Panel>
  );
}

function Editor({ existing }: { existing: CompetitionDetail | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const locked = Boolean(existing && existing.phase !== 'DRAFT');
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const [f, setF] = useState({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    category: (existing?.category ?? 'PRODUCTION') as CompetitionCategory,
    eligibility: existing?.eligibility ?? '',
    rules: existing?.rules ?? '',
    prize: existing?.prize ?? '',
    prizePlaces: existing?.prizePlaces ?? 3,
    judgingMethod: existing?.judgingMethod ?? '',
    disqualification: existing?.disqualification ?? '',
    disputeProcess:
      existing?.disputeProcess ?? 'Entrants can open a dispute within 7 days of results. MuzikHub staff review it and record a decision.',
    formats: (existing?.formats ?? ['AUDIO', 'LINK']) as EntryFormat[],
    opensAt: local(existing?.opensAt ?? new Date().toISOString()),
    closesAt: local(existing?.closesAt ?? inAWeek),
  });
  const [criteria, setCriteria] = useState(
    existing?.criteria ?? [
      { name: 'Originality', weight: 50 },
      { name: 'Execution', weight: 50 },
    ],
  );
  const [cover, setCover] = useState<MediaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const weightTotal = criteria.reduce((t, c) => t + (Number(c.weight) || 0), 0);

  async function save() {
    const body = {
      ...f,
      prizePlaces: Number(f.prizePlaces),
      criteria: criteria.map((c) => ({ name: c.name.trim(), weight: Number(c.weight) })),
      opensAt: new Date(f.opensAt).toISOString(),
      closesAt: new Date(f.closesAt).toISOString(),
      ...(cover && { coverId: cover.id }),
    };
    const parsed = competitionInputSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Please check the form');
    setBusy(true);
    setError(null);
    try {
      let saved;
      if (existing) {
        const { opensAt, closesAt, criteria: cr, formats, prizePlaces, ...rest } = parsed.data;
        saved = await compApi.update(existing.slug, locked ? rest : { ...rest, opensAt, closesAt, criteria: cr, formats, prizePlaces });
      } else {
        saved = await compApi.create(parsed.data);
      }
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      toast.success(existing ? 'Saved' : 'Draft saved. Publish it when you’re ready.');
      void navigate(`/competitions/${saved.slug}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        eyebrow="Competitions"
        title={existing ? `Edit: ${existing.title}` : 'Run a competition'}
        description="Everything here is shown to entrants before they enter. Be clear: prize terms, eligibility, judging and disputes."
      />
      <Section title="The basics">
        <Field label="Title">
          {(a) => <Input {...a} value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="Description" hint="What entrants should make, and why it matters.">
          {(a) => <Textarea {...a} rows={5} value={f.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <Field label="Category">
          {(a) => (
            <Select {...a} value={f.category} onChange={(e) => set('category', e.target.value as CompetitionCategory)}>
              {COMPETITION_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {COMPETITION_CATEGORIES[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <p className="mb-2 text-sm font-semibold">Cover image (optional)</p>
          <MediaUploader
            purpose="COMPETITION"
            kinds={['IMAGE']}
            value={cover}
            onChange={setCover}
            label="Choose a cover image"
            onBusyChange={setUploading}
          />
        </div>
      </Section>

      <Section title="Dates and entries">
        {locked && (
          <p className="text-small text-text-2">
            Dates, entry formats, criteria and prize places are fixed once published. Use “Extend” on the competition page for more time.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entries open">
            {(a) => (
              <Input {...a} type="datetime-local" value={f.opensAt} disabled={locked} onChange={(e) => set('opensAt', e.target.value)} />
            )}
          </Field>
          <Field label="Entries close">
            {(a) => (
              <Input {...a} type="datetime-local" value={f.closesAt} disabled={locked} onChange={(e) => set('closesAt', e.target.value)} />
            )}
          </Field>
        </div>
        <fieldset disabled={locked}>
          <legend className="mb-2 text-sm font-semibold">Accepted entries</legend>
          <div className="flex flex-wrap gap-4">
            {ENTRY_FORMAT_KEYS.map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-signal"
                  checked={f.formats.includes(k)}
                  onChange={(e) => set('formats', e.target.checked ? [...f.formats, k] : f.formats.filter((x) => x !== k))}
                />
                {ENTRY_FORMATS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Eligibility" hint="Who can enter.">
          {(a) => <Textarea {...a} rows={3} value={f.eligibility} maxLength={2000} onChange={(e) => set('eligibility', e.target.value)} />}
        </Field>
        <Field
          label="Rules"
          hint={
            existing && existing.phase !== 'DRAFT'
              ? 'Changing the rules now creates a new version; entrants are told.'
              : 'Entrants must accept these before entering.'
          }
        >
          {(a) => <Textarea {...a} rows={6} value={f.rules} maxLength={8000} onChange={(e) => set('rules', e.target.value)} />}
        </Field>
      </Section>

      <Section title="Prize and judging">
        <Field label="Prize" hint="Say who provides it. MuzikHub doesn’t guarantee prizes.">
          {(a) => <Input {...a} value={f.prize} maxLength={1000} onChange={(e) => set('prize', e.target.value)} />}
        </Field>
        <Field label="Places awarded">
          {(a) => (
            <Input
              {...a}
              type="number"
              min={1}
              max={10}
              value={f.prizePlaces}
              disabled={locked}
              onChange={(e) => set('prizePlaces', Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="How judging works">
          {(a) => (
            <Textarea {...a} rows={3} value={f.judgingMethod} maxLength={2000} onChange={(e) => set('judgingMethod', e.target.value)} />
          )}
        </Field>
        <fieldset disabled={locked}>
          <legend className="mb-2 text-sm font-semibold">Judging criteria (weights add up to 100)</legend>
          <ul className="space-y-2">
            {criteria.map((c, i) => (
              <li key={i} className="flex items-end gap-2">
                <Input
                  aria-label={`Criterion ${i + 1} name`}
                  value={c.name}
                  maxLength={40}
                  onChange={(e) => setCriteria((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="flex-1"
                />
                <Input
                  aria-label={`Criterion ${i + 1} weight`}
                  type="number"
                  min={1}
                  max={100}
                  value={c.weight}
                  onChange={(e) => setCriteria((cur) => cur.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  aria-label={`Remove criterion ${i + 1}`}
                  disabled={criteria.length === 1}
                  onClick={() => setCriteria((cur) => cur.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={criteria.length >= 6}
              onClick={() => setCriteria((cur) => [...cur, { name: '', weight: 0 }])}
            >
              <Plus /> Add criterion
            </Button>
            <span className={weightTotal === 100 ? 'text-caption text-text-2' : 'text-caption text-warning'} role="status">
              Total weight: {weightTotal}/100
            </span>
          </div>
        </fieldset>
        <Field label="Disqualification" hint="What gets an entry removed.">
          {(a) => (
            <Textarea
              {...a}
              rows={2}
              value={f.disqualification}
              maxLength={2000}
              onChange={(e) => set('disqualification', e.target.value)}
            />
          )}
        </Field>
        <Field label="Disputes">
          {(a) => (
            <Textarea {...a} rows={2} value={f.disputeProcess} maxLength={2000} onChange={(e) => set('disputeProcess', e.target.value)} />
          )}
        </Field>
      </Section>

      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy || uploading}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save draft'}
        </Button>
        <Button variant="ghost" onClick={() => void navigate(existing ? `/competitions/${existing.slug}` : '/competitions')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
