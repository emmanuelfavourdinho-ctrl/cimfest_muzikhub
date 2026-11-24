import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { ArrowLeft, ArrowRight, Briefcase, Headphones, Mic } from 'lucide-react';
import { PRIMARY_USES, registerSchema, usernameSchema, type PrimaryUse, type RegisterInput } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Eyebrow, Panel } from '@/components/ui/primitives';
import { authClient, unwrap } from '@/lib/auth-client';
import { errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { AuthLayout } from './AuthLayout';

const useIcons: Record<PrimaryUse, typeof Mic> = { CREATOR: Mic, FAN: Headphones, PROFESSIONAL: Briefcase };

/**
 * Two short steps (FR-01, FR-03):
 *  1. How do you want to use MuzikHub?
 *  2. Name, username, email, password.
 * Everything else happens in onboarding, after the account exists.
 */
export function RegisterPage() {
  const [primaryUse, setPrimaryUse] = useState<PrimaryUse | null>(null);

  return (
    <AuthLayout>
      <Panel className="p-5 sm:p-7">
        {primaryUse === null ? (
          <ChooseUse onChoose={setPrimaryUse} />
        ) : (
          <AccountForm primaryUse={primaryUse} onBack={() => setPrimaryUse(null)} />
        )}
        <p className="mt-6 text-center text-sm text-text-2">
          Already on MuzikHub?{' '}
          <Link to="/login" className="font-semibold text-signal hover:underline">
            Sign in
          </Link>
        </p>
      </Panel>
    </AuthLayout>
  );
}

function ChooseUse({ onChoose }: { onChoose: (use: PrimaryUse) => void }) {
  return (
    <div>
      <Eyebrow>Join MuzikHub · Step 1 of 2</Eyebrow>
      <h1 className="mt-2 mb-1 text-2xl font-bold">How do you want to use MuzikHub?</h1>
      <p className="mb-5 text-sm text-text-2">You can add more professional roles to your profile at any time.</p>
      <div className="grid gap-3">
        {(Object.keys(PRIMARY_USES) as PrimaryUse[]).map((key) => {
          const Icon = useIcons[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChoose(key)}
              className="group flex min-h-20 items-center gap-4 rounded-m border border-control-border bg-surface-overlay p-4 text-left transition hover:border-signal hover:bg-surface-chip"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-chip text-signal">
                <Icon className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-bold">{PRIMARY_USES[key].label}</span>
                <span className="block text-xs leading-relaxed text-text-2">{PRIMARY_USES[key].description}</span>
              </span>
              <ArrowRight className="size-4 text-text-2 transition group-hover:translate-x-0.5 group-hover:text-signal" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

function AccountForm({ primaryUse, onBack }: { primaryUse: PrimaryUse; onBack: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

  const { register, handleSubmit, watch, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { primaryUse, name: '', username: '', email: '', password: '' },
    mode: 'onTouched',
  });
  const { errors, isSubmitting } = formState;
  const username = watch('username');

  // Debounced availability check. The server still enforces uniqueness on submit.
  useEffect(() => {
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      const { data, error } = await authClient.isUsernameAvailable({ username: parsed.data });
      setUsernameStatus(error ? 'unknown' : data?.available ? 'available' : 'taken');
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await unwrap(
        authClient.signUp.email({ ...values, displayUsername: values.username, callbackURL: `${window.location.origin}/email-verified` }),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate('/onboarding', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  const usernameHint = {
    idle: 'Your profile address: muzikhub/u/yourname',
    checking: 'Checking availability…',
    available: '✓ Available',
    taken: undefined,
    unknown: "Couldn't check availability — we'll confirm when you continue.",
  }[usernameStatus];

  return (
    <form onSubmit={onSubmit} noValidate>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 -ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-text-2 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {PRIMARY_USES[primaryUse].label}
      </button>
      <Eyebrow>Join MuzikHub · Step 2 of 2</Eyebrow>
      <h1 className="mt-2 mb-5 text-2xl font-bold">Create your account</h1>

      <FormError message={formError} />

      <Field label="Name" error={errors.name?.message}>
        {(a) => <Input {...a} autoComplete="name" placeholder="Your name or artist name" {...register('name')} />}
      </Field>
      <Field
        label="Username"
        error={errors.username?.message ?? (usernameStatus === 'taken' ? 'That username is taken' : undefined)}
        hint={<span className={cn(usernameStatus === 'available' && 'text-signal')}>{usernameHint}</span>}
      >
        {(a) => (
          <Input
            {...a}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="e.g. ayo.nova"
            {...register('username')}
          />
        )}
      </Field>
      <Field label="Email" error={errors.email?.message}>
        {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" {...register('email')} />}
      </Field>
      <Field label="Password" error={errors.password?.message} hint="At least 8 characters.">
        {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password')} />}
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || usernameStatus === 'taken'}>
        {isSubmitting ? 'Creating your account…' : 'Create account'}
        {!isSubmitting && <ArrowRight />}
      </Button>
      {/* New tab, so a half-filled form is never lost. Drafts: "read", not "you agree to". */}
      <p className="mt-4 text-center text-caption text-text-2">
        Read the draft{' '}
        <Link to="/terms" target="_blank" rel="noopener" className="font-semibold text-text-1 underline underline-offset-4">
          Terms<span className="sr-only"> (opens in a new tab)</span>
        </Link>{' '}
        and{' '}
        <Link to="/privacy" target="_blank" rel="noopener" className="font-semibold text-text-1 underline underline-offset-4">
          Privacy notice<span className="sr-only"> (opens in a new tab)</span>
        </Link>
        .
      </p>
    </form>
  );
}
