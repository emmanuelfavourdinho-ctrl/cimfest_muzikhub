import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  BIO_MAX,
  CAREER_STAGE_KEYS,
  CAREER_STAGES,
  SUGGESTED_ROLES,
  type CareerStage,
  type CreativeRole,
  type Genre,
  type Goal,
  type Me,
  type UpdateProfileInput,
} from '@muzikhub/shared';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Eyebrow, PageLoading, Panel } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { useCompleteOnboarding, useMe, useUpdateProfile } from '@/lib/queries';
import { LinksEditor } from '@/features/profile/LinksEditor';
import { GenrePicker, GoalPicker, RolePicker } from '@/features/profile/pickers';

type StepId = 'roles' | 'genres' | 'about' | 'links';

/** FR-04: role-aware steps. Fans skip the professional-identity steps. */
function stepsFor(me: Me): StepId[] {
  return me.profile.primaryUse === 'FAN' ? ['genres', 'about'] : ['roles', 'genres', 'about', 'links'];
}

export function OnboardingPage() {
  const { data: me, isPending } = useMe();
  // Decide "already completed?" once, on arrival. Re-checking on every render would race with
  // the flow's own redirect: finishing onboarding updates `me`, and this guard would win.
  const [completedOnArrival, setCompletedOnArrival] = useState<boolean | null>(null);
  if (completedOnArrival === null && me) setCompletedOnArrival(Boolean(me.profile.onboardingCompletedAt));

  if (isPending || (me && completedOnArrival === null)) return <PageLoading />;
  if (!me) return <Navigate to="/login" replace />;
  if (completedOnArrival) return <Navigate to="/settings/profile" replace />;
  return <OnboardingFlow me={me} />;
}

function OnboardingFlow({ me }: { me: Me }) {
  const navigate = useNavigate();
  const steps = stepsFor(me);
  // Resume where the user stopped (progress is saved on the server after every step).
  const [index, setIndex] = useState(Math.min(me.profile.onboardingStep, steps.length - 1));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateProfile();
  const complete = useCompleteOnboarding();

  const [roles, setRoles] = useState<CreativeRole[]>(me.profile.roles);
  const [genres, setGenres] = useState<Genre[]>(me.profile.genres);
  const [goals, setGoals] = useState<Goal[]>(me.profile.goals);
  const [bio, setBio] = useState(me.profile.bio ?? '');
  const [location, setLocation] = useState(me.profile.location ?? '');
  const [careerStage, setCareerStage] = useState<CareerStage | ''>(me.profile.careerStage ?? '');

  const step = steps[index]!;
  const isLast = index === steps.length - 1;
  const busy = update.isPending || complete.isPending;

  async function advance(data: UpdateProfileInput) {
    setError(null);
    try {
      await update.mutateAsync({ ...data, onboardingStep: index + 1 });
      if (isLast) {
        const done = await complete.mutateAsync();
        toast.success('Welcome to MuzikHub — your profile is live.');
        void navigate(`/u/${done.profile.username}`, { replace: true });
      } else {
        setIndex(index + 1);
        window.scrollTo(0, 0);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const stepData: Record<StepId, () => UpdateProfileInput> = {
    roles: () => ({ roles }),
    genres: () => ({ genres, goals }),
    about: () => ({
      bio: bio.trim() || null,
      location: location.trim() || null,
      ...(me.profile.primaryUse !== 'FAN' && { careerStage: careerStage || null }),
    }),
    links: () => ({}),
  };

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14.75 items-center justify-between border-b border-hairline-strong px-4 sm:h-16.5 sm:px-8">
        <BrandMark to="/home" />
        <Link to="/home" className="rounded-lg px-2 py-2 text-xs font-semibold text-text-2 hover:text-foreground">
          Finish later
        </Link>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
        <Progress current={index} total={steps.length} />
        <Panel className="mt-5 p-5 sm:p-7">
          <FormError message={error} />
          {step === 'roles' && (
            <StepIntro
              eyebrow="Your professional identity"
              title="What do you do in music?"
              description="Pick everything that fits — many people are, say, both a producer and an engineer."
            >
              <RolePicker
                label="Professional roles"
                value={roles}
                onChange={setRoles}
                max={6}
                suggested={SUGGESTED_ROLES[me.profile.primaryUse ?? 'CREATOR']}
              />
            </StepIntro>
          )}
          {step === 'genres' && (
            <StepIntro
              eyebrow="Your sound"
              title="Which genres are you into?"
              description="This shapes what you discover and who discovers you."
            >
              <GenrePicker label="Genres" value={genres} onChange={setGenres} max={8} />
              <h3 className="mt-7 mb-3 text-sm font-bold">What brings you to MuzikHub?</h3>
              <GoalPicker label="Goals" value={goals} onChange={setGoals} max={7} />
            </StepIntro>
          )}
          {step === 'about' && (
            <StepIntro
              eyebrow="About you"
              title="Introduce yourself"
              description="A few lines help people understand your work and what you're looking for."
            >
              <Field label="Short bio" hint={`${bio.length}/${BIO_MAX}`}>
                {(a) => (
                  <Textarea
                    {...a}
                    value={bio}
                    maxLength={BIO_MAX}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="e.g. Afro-fusion artist from Douala. Looking for producers for my next EP."
                  />
                )}
              </Field>
              <Field label="Location">
                {(a) => (
                  <Input
                    {...a}
                    value={location}
                    maxLength={80}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City, Country"
                    autoComplete="address-level2"
                  />
                )}
              </Field>
              {me.profile.primaryUse !== 'FAN' && (
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
              )}
            </StepIntro>
          )}
          {step === 'links' && (
            <StepIntro
              eyebrow="Your music elsewhere"
              title="Where can people hear your work?"
              description="Add your Spotify, YouTube, SoundCloud, Instagram or website. They appear as recognisable icons on your profile."
            >
              <LinksEditor initial={me.profile.links} submitLabel="Save & finish" onSaved={() => void advance({})} />
            </StepIntro>
          )}

          <div className="mt-7 flex items-center justify-between gap-3 border-t border-hairline-strong pt-5">
            <Button variant="quiet" size="sm" onClick={() => setIndex(index - 1)} disabled={index === 0 || busy}>
              <ArrowLeft /> Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void advance({})}>
                {isLast ? 'Skip & finish' : 'Skip'}
              </Button>
              {step !== 'links' && (
                <Button size="sm" disabled={busy} onClick={() => void advance(stepData[step]())}>
                  {busy ? 'Saving…' : isLast ? 'Finish' : 'Continue'}
                  {!busy && <ArrowRight />}
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-xs font-semibold text-text-2">
        <span>Set up your profile</span>
        <span>
          Step {current + 1} of {total}
        </span>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-label="Profile setup progress"
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= current ? 'bg-signal' : 'bg-surface-chip'}`} />
        ))}
      </div>
    </div>
  );
}

function StepIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-2 text-2xl font-bold sm:text-2xl">{title}</h1>
      <p className="mt-1 mb-6 text-sm text-text-2">{description}</p>
      {children}
    </div>
  );
}
