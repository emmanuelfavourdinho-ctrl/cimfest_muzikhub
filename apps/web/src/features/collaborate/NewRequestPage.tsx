import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { COLLABORATION_TYPE_KEYS, COLLABORATION_TYPES, createCollabRequestSchema, type CollaborationType } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Avatar, EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { collabApi } from '@/lib/collaboration';
import { usePublicProfile } from '@/lib/queries';

/** /collaborate/new?to=username — a structured request (COL-002). */
export function NewRequestPage() {
  const [params] = useSearchParams();
  const to = (params.get('to') ?? '').toLowerCase();
  const profile = usePublicProfile(to);
  if (!to) return <EmptyState title="Who would you like to work with?">Open someone’s profile and choose Collaborate.</EmptyState>;
  if (profile.isPending) return <PageLoading />;
  if (profile.isError) return <LoadFailed message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />;
  return <Form to={to} name={profile.data.name} image={profile.data.image} />;
}

function Form({ to, name, image }: { to: string; name: string; image: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [type, setType] = useState<CollaborationType>('FEATURE');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [refs, setRefs] = useState<string[]>(['']);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => crypto.randomUUID(), []);

  async function send() {
    const input = {
      username: to,
      type,
      title,
      role,
      description,
      references: refs.map((r) => r.trim()).filter(Boolean),
      deadline: deadline ? new Date(`${deadline}T23:59:00`).toISOString() : null,
    };
    const parsed = createCollabRequestSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Please check the form');
    setBusy(true);
    setError(null);
    try {
      const r = await collabApi.create(input, key);
      await qc.invalidateQueries({ queryKey: ['collab'] });
      toast.success(`Request sent to ${name}`);
      void navigate(`/collaborate/requests/${r.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Collaborate" title="Propose a collaboration" />
      <Panel className="space-y-4 p-5 sm:p-6">
        <p className="flex items-center gap-3 text-small text-text-2">
          <Avatar name={name} image={image} className="size-9 text-xs" /> To <strong className="text-text-1">{name}</strong>
        </p>
        <Field label="Kind of collaboration">
          {(a) => (
            <Select {...a} value={type} onChange={(e) => setType(e.target.value as CollaborationType)}>
              {COLLABORATION_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {COLLABORATION_TYPES[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Project title">
          {(a) => (
            <Input {...a} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Afro-soul single" />
          )}
        </Field>
        <Field label="What would you like them to do?" hint="Their role or contribution.">
          {(a) => <Input {...a} value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Hook vocals" />}
        </Field>
        <Field label="About the project" hint={`${description.length}/3000 · what it is, what you have so far, what you expect`}>
          {(a) => <Textarea {...a} value={description} rows={5} maxLength={3000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">References (optional)</legend>
          {refs.map((r, i) => (
            <Input
              key={i}
              aria-label={`Reference link ${i + 1}`}
              value={r}
              onChange={(e) => setRefs((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="https:// a demo, a track you like, a moodboard"
            />
          ))}
          {refs.length < 5 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRefs((cur) => [...cur, ''])}>
              Add another link
            </Button>
          )}
        </fieldset>
        <Field label="Deadline (optional)">
          {(a) => <Input {...a} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
        <p className="text-caption text-text-3">
          {name} can accept, decline or ask you a question. The conversation continues in your messages. This records an agreement to work
          together; it isn’t a contract or a payment.
        </p>
        <FormError message={error} />
        <div className="flex gap-2">
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
          <Button variant="ghost" onClick={() => void navigate(-1)}>
            Cancel
          </Button>
        </div>
      </Panel>
    </div>
  );
}
