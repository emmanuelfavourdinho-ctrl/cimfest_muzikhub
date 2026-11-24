import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, X } from 'lucide-react';
import {
  BIO_MAX,
  CAREER_STAGE_KEYS,
  CAREER_STAGES,
  PRIMARY_USE_KEYS,
  PRIMARY_USES,
  SUGGESTED_ROLES,
  updateProfileSchema,
  type CareerStage,
  type CreativeRole,
  type Genre,
  type Goal,
  type Me,
  type MediaView,
  type PrimaryUse,
} from '@muzikhub/shared';
import { ResponsiveImage } from '@/components/media/Media';
import { MediaUploader } from '@/components/media/MediaUploader';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { queryKeys, useMe, useUpdateProfile } from '@/lib/queries';
import { LinksEditor } from './LinksEditor';
import { cn } from '@/lib/cn';
import { GenrePicker, GoalPicker, RolePicker } from './pickers';
import { useEntitlements } from '@/lib/billing';
import { ACCENT_BAR } from '@/features/billing/ui';
import { PROFILE_ACCENT_KEYS, PROFILE_ACCENTS, type ProfileAccent } from '@muzikhub/shared';

/** FR-06: update profile information and professional roles at any time. */
export function EditProfilePage() {
  const { data: me } = useMe();
  if (!me) return <PageLoading />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Your profile"
        title="Edit profile"
        description="Everything here appears on your public profile."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={`/u/${me.profile.username}`}>
              View profile <ExternalLink />
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        <DetailsSection me={me} />
        <IdentitySection me={me} />
        <Section title="External links" description="Shown on your profile as platform icons.">
          <LinksEditor initial={me.profile.links} onSaved={() => toast.success('Links saved')} />
        </Section>
        <PhotosSection me={me} />
        <AccentSection me={me} />
      </div>
    </div>
  );
}

/**
 * Upload → verified by the API → set on the profile. Replacing or removing a photo deletes
 * the old file from Cloudinary on the server.
 */
function PhotosSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  async function apply(slot: 'avatar' | 'cover', media: MediaView | null) {
    setSaving(true);
    try {
      const updated = await api.setProfileImage(slot, media?.id ?? null);
      qc.setQueryData(queryKeys.me, updated);
      await qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success(media ? (slot === 'avatar' ? 'Profile photo updated' : 'Cover updated') : 'Removed');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Photos" description="A clear photo and a cover help people recognise you.">
      <div className="grid gap-6 sm:grid-cols-[--spacing(50)_1fr]">
        <div>
          <p className="mb-2 text-xs font-bold text-text-1">Profile photo</p>
          {me.profile.image ? (
            <div>
              <img
                src={me.profile.image}
                alt="Your current avatar"
                className="size-24 rounded-full border-2 border-control-border object-cover"
              />
              <div className="mt-2 flex gap-2">
                <Button variant="quiet" size="sm" disabled={saving} onClick={() => void apply('avatar', null)}>
                  Remove
                </Button>
              </div>
            </div>
          ) : null}
          <div className={me.profile.image ? 'mt-2' : ''}>
            <MediaUploader
              purpose="AVATAR"
              value={null}
              onChange={(m) => m && void apply('avatar', m)}
              label={me.profile.image ? 'Replace photo' : 'Upload a photo'}
            />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold text-text-1">Cover image</p>
          {me.profile.cover ? (
            <div className="mb-2">
              <ResponsiveImage
                media={me.profile.cover}
                alt="Your cover image"
                aspect="16 / 5"
                className="rounded-xl"
                sizes="(min-width: 768px) 520px, 100vw"
              />
              <Button variant="quiet" size="sm" className="mt-2" disabled={saving} onClick={() => void apply('cover', null)}>
                Remove
              </Button>
            </div>
          ) : null}
          <MediaUploader
            purpose="COVER"
            value={null}
            onChange={(m) => m && void apply('cover', m)}
            label={me.profile.cover ? 'Replace cover' : 'Upload a cover'}
          />
        </div>
      </div>
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Panel className="p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-text-2">{description}</p>}
      <div className="mt-5">{children}</div>
    </Panel>
  );
}

function useSave() {
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const save = async (input: Parameters<typeof update.mutateAsync>[0], successMessage: string) => {
    setError(null);
    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    try {
      await update.mutateAsync(input);
      toast.success(successMessage);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return { save, error, pending: update.isPending };
}

function DetailsSection({ me }: { me: Me }) {
  const [name, setName] = useState(me.profile.name);
  const [bio, setBio] = useState(me.profile.bio ?? '');
  const [location, setLocation] = useState(me.profile.location ?? '');
  const [careerStage, setCareerStage] = useState<CareerStage | ''>(me.profile.careerStage ?? '');
  const { save, error, pending } = useSave();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(
      { name: name.trim(), bio: bio.trim() || null, location: location.trim() || null, careerStage: careerStage || null },
      'Profile details saved',
    );
  }

  return (
    <Section title="Details">
      <form onSubmit={onSubmit} noValidate>
        <FormError message={error} />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Name">
            {(a) => <Input {...a} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          </Field>
          <Field label="Location">
            {(a) => (
              <Input {...a} value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} placeholder="City, Country" />
            )}
          </Field>
        </div>
        <Field label="Bio" hint={`${bio.length}/${BIO_MAX}`}>
          {(a) => <Textarea {...a} value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} />}
        </Field>
        <Field label="Career stage">
          {(a) => (
            <Select {...a} value={careerStage} onChange={(e) => setCareerStage(e.target.value as CareerStage | '')}>
              <option value="">Prefer not to say</option>
              {CAREER_STAGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CAREER_STAGES[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
      </form>
    </Section>
  );
}

function IdentitySection({ me }: { me: Me }) {
  const [primaryUse, setPrimaryUse] = useState<PrimaryUse>(me.profile.primaryUse ?? 'CREATOR');
  const [roles, setRoles] = useState<CreativeRole[]>(me.profile.roles);
  const [genres, setGenres] = useState<Genre[]>(me.profile.genres);
  const [goals, setGoals] = useState<Goal[]>(me.profile.goals);
  const [skills, setSkills] = useState<string[]>(me.profile.skills);
  const [skillDraft, setSkillDraft] = useState('');
  const { save, error, pending } = useSave();

  function addSkill() {
    const value = skillDraft.trim();
    if (value && !skills.includes(value) && skills.length < 12) setSkills([...skills, value]);
    setSkillDraft('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save({ primaryUse, roles, genres, goals, skills }, 'Professional identity saved');
  }

  return (
    <Section title="Professional identity" description="Your roles, sound and skills help the right people find you.">
      <form onSubmit={onSubmit} noValidate>
        <FormError message={error} />
        <Field label="I mainly use MuzikHub as">
          {(a) => (
            <Select {...a} value={primaryUse} onChange={(e) => setPrimaryUse(e.target.value as PrimaryUse)}>
              {PRIMARY_USE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PRIMARY_USES[k].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <h3 className="mb-2.5 text-xs font-bold text-text-1">Roles</h3>
        <RolePicker label="Roles" value={roles} onChange={setRoles} max={6} suggested={SUGGESTED_ROLES[primaryUse]} />
        <h3 className="mt-6 mb-2.5 text-xs font-bold text-text-1">Genres</h3>
        <GenrePicker label="Genres" value={genres} onChange={setGenres} max={8} />
        <h3 className="mt-6 mb-2.5 text-xs font-bold text-text-1">Skills</h3>
        <div className="flex gap-2">
          <Input
            aria-label="Add a skill"
            value={skillDraft}
            maxLength={40}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder="e.g. Vocal arrangement, Logic Pro, Live sound"
          />
          <Button type="button" variant="outline" onClick={addSkill} disabled={skills.length >= 12}>
            Add
          </Button>
        </div>
        {skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {skills.map((s) => (
              <li
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-control-border bg-surface-chip py-1 pr-1 pl-3 text-xs text-signal"
              >
                {s}
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  onClick={() => setSkills(skills.filter((x) => x !== s))}
                  className="rounded-full p-1 hover:bg-surface-chip"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-6 mb-2.5 text-xs font-bold text-text-1">What you're here for</h3>
        <GoalPicker label="Goals" value={goals} onChange={setGoals} max={7} />
        <Button type="submit" size="sm" className="mt-6" disabled={pending}>
          {pending ? 'Saving…' : 'Save identity'}
        </Button>
      </form>
    </Section>
  );
}

/** Paid benefit: an accent colour from the approved palette. The API checks the plan. */
function AccentSection({ me }: { me: Me }) {
  const ent = useEntitlements();
  const allowed = ent.data?.limits.profileAccent ?? false;
  const [accent, setAccent] = useState<ProfileAccent | null>(me.profile.accent);
  const { save, error, pending } = useSave();
  return (
    <Section title="Profile accent" description="A colour for your profile header and photo ring. Part of Creator Plus and MuzikHub Pro.">
      {!allowed ? (
        <p className="text-small text-text-2">
          Your plan doesn’t include an accent.{' '}
          <Link to="/pricing" className="text-signal underline">
            See plans
          </Link>
        </p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
            {([null, ...PROFILE_ACCENT_KEYS] as (ProfileAccent | null)[]).map((key) => (
              <button
                key={key ?? 'none'}
                type="button"
                role="radio"
                aria-checked={accent === key}
                onClick={() => setAccent(key)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-s border px-3 text-small',
                  accent === key ? 'border-signal text-text-1' : 'border-control-border text-text-2',
                )}
              >
                <span aria-hidden className={cn('size-4 rounded-full', key ? ACCENT_BAR[key] : 'border border-control-border')} />
                {key ? PROFILE_ACCENTS[key] : 'Default'}
              </button>
            ))}
          </div>
          <FormError message={error} />
          <Button className="mt-4" size="sm" disabled={pending} onClick={() => void save({ accent }, 'Accent saved')}>
            {pending ? 'Saving…' : 'Save accent'}
          </Button>
        </>
      )}
    </Section>
  );
}
