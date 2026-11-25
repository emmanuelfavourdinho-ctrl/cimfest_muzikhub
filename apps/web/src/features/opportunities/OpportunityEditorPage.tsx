import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OPPORTUNITY_TYPE_KEYS, OPPORTUNITY_TYPES, type OpportunityType, type OpportunityView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { api, errorMessage } from '@/lib/api';
import { OrganiserAccessNeeded } from './OrganiserAccessNeeded';

/** Create (/opportunities/new) or edit (/opportunities/:id/edit). */
export function OpportunityEditorPage() {
  const { id } = useParams();
  const status = useQuery({ queryKey: ['opportunities', 'organiser-status'], queryFn: api.organiserStatus });
  const existing = useQuery({ queryKey: ['opportunities', 'detail', id], queryFn: () => api.opportunity(id!), enabled: Boolean(id) });

  if (status.isPending || (id && existing.isPending)) return <PageLoading />;
  if (status.isError) return <LoadFailed message={errorMessage(status.error)} onRetry={() => void status.refetch()} />;
  if (existing.isError) return <LoadFailed message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} />;
  if (!id && !status.data.canOrganise) {
    return (
      <OrganiserAccessNeeded
        missing={status.data.missing}
        what="Publishing opportunities"
        back={{ to: '/opportunities', label: 'Browse opportunities' }}
      />
    );
  }
  if (existing.data && !existing.data.isOwner) {
    return <EmptyState title="You can't edit this opportunity">Only its organiser can change it.</EmptyState>;
  }
  return <Editor existing={existing.data ?? null} />;
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function Editor({ existing }: { existing: OpportunityView | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: (existing?.type ?? 'GIG') as OpportunityType,
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    requirements: existing?.requirements ?? '',
    location: existing?.location ?? '',
    remote: existing?.remote ?? false,
    deadline: existing ? toLocalInput(existing.deadline) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = { ...form, deadline: new Date(form.deadline).toISOString() };
    try {
      const saved = existing ? await api.updateOpportunity(existing.id, input) : await api.createOpportunity(input, key.current);
      qc.setQueryData(['opportunities', 'detail', saved.id], saved);
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      navigate(`/opportunities/${saved.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Opportunities"
        title={existing ? 'Edit opportunity' : 'Post an opportunity'}
        description={existing ? undefined : 'Saved as a draft. Publish it from its page when you are ready.'}
      />
      <Panel className="p-5">
        <form onSubmit={submit} noValidate>
          <FormError message={error} />
          <Field label="Type">
            {(a) => (
              <Select {...a} value={form.type} onChange={(e) => set('type', e.target.value as OpportunityType)}>
                {OPPORTUNITY_TYPE_KEYS.map((t) => (
                  <option key={t} value={t}>
                    {OPPORTUNITY_TYPES[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Title">
            {(a) => <Input {...a} value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field label="Description" hint="At least 20 characters: what, when, and what you offer.">
            {(a) => (
              <Textarea {...a} rows={5} value={form.description} maxLength={5000} onChange={(e) => set('description', e.target.value)} />
            )}
          </Field>
          <Field label="Requirements (optional)">
            {(a) => (
              <Textarea {...a} rows={3} value={form.requirements} maxLength={2000} onChange={(e) => set('requirements', e.target.value)} />
            )}
          </Field>
          <Field label="Location (optional)">
            {(a) => <Input {...a} value={form.location} maxLength={120} onChange={(e) => set('location', e.target.value)} />}
          </Field>
          <label className="mb-4 flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={form.remote}
              onChange={(e) => set('remote', e.target.checked)}
              className="size-4 accent-signal"
            />{' '}
            Can be done remotely
          </label>
          <Field label="Application deadline">
            {(a) => <Input {...a} type="datetime-local" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !form.deadline}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Save draft'}
            </Button>
            <Button asChild variant="quiet">
              <Link to={existing ? `/opportunities/${existing.id}` : '/opportunities'}>Cancel</Link>
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
