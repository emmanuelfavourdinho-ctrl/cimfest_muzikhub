import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_CATEGORY_KEYS,
  COMMUNITY_POLICIES,
  COMMUNITY_POLICY_KEYS,
  createCommunitySchema,
  type CommunityCategory,
  type CommunityDetail,
  type CommunityPolicy,
  type Genre,
  type MediaView,
} from '@muzikhub/shared';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { GenrePicker } from '@/features/profile/pickers';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { communitiesApi, communityKeys } from '@/lib/communities';

/** /communities/new and /communities/:slug/settings */
export function CommunityEditorPage() {
  const { slug } = useParams();
  const existing = useQuery({
    queryKey: communityKeys.detail(slug ?? ''),
    queryFn: () => communitiesApi.detail(slug!),
    enabled: Boolean(slug),
  });
  if (slug && existing.isPending) return <PageLoading />;
  if (slug && existing.isError) return <LoadFailed message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} />;
  if (slug && existing.data && !existing.data.permissions.editSettings) {
    return <EmptyState title="You can’t change these settings">Only the community’s owner and admins can.</EmptyState>;
  }
  return <Editor existing={existing.data ?? null} />;
}

function Editor({ existing }: { existing: CommunityDetail | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category, setCategory] = useState<CommunityCategory>(existing?.category ?? 'PRODUCTION');
  const [policy, setPolicy] = useState<CommunityPolicy>(existing?.policy ?? 'OPEN');
  const [rules, setRules] = useState(existing?.rules ?? '');
  const [interests, setInterests] = useState<Genre[]>((existing?.interests as Genre[]) ?? []);
  const [cover, setCover] = useState<MediaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function save() {
    const body = { name, description, category, policy, rules, interests, ...(cover && { coverId: cover.id }) };
    const parsed = createCommunitySchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = existing ? await communitiesApi.update(existing.slug, parsed.data) : await communitiesApi.create(parsed.data);
      await qc.invalidateQueries({ queryKey: communityKeys.all });
      toast.success(existing ? 'Settings saved' : 'Community created');
      void navigate(`/communities/${saved.slug}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Communities"
        title={existing ? `Settings: ${existing.name}` : 'Start a community'}
        description={existing ? undefined : 'A place for ongoing conversation. You’ll be its owner and can add moderators later.'}
      />
      <Panel className="space-y-4 p-5 sm:p-6">
        <Field label="Name" hint={`${name.length}/80`}>
          {(a) => (
            <Input
              {...a}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Douala Producers Circle"
            />
          )}
        </Field>
        <Field label="What is it for?" hint={`${description.length}/1000 · at least 20 characters`}>
          {(a) => <Textarea {...a} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label="Category">
          {(a) => (
            <Select {...a} value={category} onChange={(e) => setCategory(e.target.value as CommunityCategory)}>
              {COMMUNITY_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {COMMUNITY_CATEGORIES[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Who can join?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {COMMUNITY_POLICY_KEYS.map((k) => (
              <label
                key={k}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-s border p-3 text-small',
                  policy === k ? 'border-signal bg-surface-overlay' : 'border-control-border',
                )}
              >
                <span className="flex items-center gap-2 font-semibold text-text-1">
                  <input
                    type="radio"
                    name="policy"
                    value={k}
                    checked={policy === k}
                    onChange={() => setPolicy(k)}
                    className="accent-signal"
                  />
                  {COMMUNITY_POLICIES[k].label}
                </span>
                <span className="text-caption text-text-2">{COMMUNITY_POLICIES[k].help}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Community rules" hint="Shown to everyone before they join. At least 10 characters.">
          {(a) => (
            <Textarea
              {...a}
              value={rules}
              rows={5}
              maxLength={4000}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Be respectful. Credit collaborators. No spam."
            />
          )}
        </Field>
        <div>
          <p className="mb-2 text-sm font-semibold">Genres (optional)</p>
          <GenrePicker label="Genres" value={interests} onChange={setInterests} max={5} />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Cover image (optional)</p>
          <MediaUploader
            purpose="COMMUNITY"
            kinds={['IMAGE']}
            value={cover}
            onChange={setCover}
            label="Choose a cover image"
            onBusyChange={setUploading}
          />
        </div>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy || uploading}>
            {busy ? 'Saving…' : existing ? 'Save settings' : 'Create community'}
          </Button>
          <Button variant="ghost" onClick={() => void navigate(existing ? `/communities/${existing.slug}` : '/communities')}>
            Cancel
          </Button>
        </div>
      </Panel>
    </div>
  );
}
