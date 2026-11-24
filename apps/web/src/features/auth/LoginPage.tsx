import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Eyebrow, Panel } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { authClient, unwrap } from '@/lib/auth-client';
import { queryKeys } from '@/lib/queries';
import { AuthLayout } from './AuthLayout';
import { safeNextPath } from './guards';

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Enter your password'),
});
type LoginInput = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  /** Set when the account uses two-factor authentication: a code is needed to finish signing in. */
  const [needsCode, setNeedsCode] = useState(false);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function finish() {
    const me = await api.me();
    queryClient.setQueryData(queryKeys.me, me);
    const next = safeNextPath(params.get('next'));
    void navigate(next ?? (me.profile.onboardingCompletedAt ? '/home' : '/onboarding'), { replace: true });
  }

  const onSubmit = handleSubmit(async ({ identifier, password }) => {
    setFormError(null);
    try {
      // One field for both: an @ means email, otherwise username.
      const result = await unwrap(
        identifier.includes('@')
          ? authClient.signIn.email({ email: identifier, password })
          : authClient.signIn.username({ username: identifier.toLowerCase(), password }),
      );
      if ((result as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        setNeedsCode(true); // no session yet — Better Auth waits for the second factor
        return;
      }
      await finish();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <Panel className="p-5 sm:p-7">
        {needsCode ? (
          <TwoFactorStep onDone={finish} onBack={() => setNeedsCode(false)} />
        ) : (
          <>
            <Eyebrow>Welcome back</Eyebrow>
            <h1 className="mt-2 mb-5 text-2xl font-bold">Sign in to MuzikHub</h1>
            <form onSubmit={onSubmit} noValidate>
              <FormError message={formError} />
              <Field label="Email or username" error={formState.errors.identifier?.message}>
                {(a) => <Input {...a} autoComplete="username" autoCapitalize="none" spellCheck={false} {...register('identifier')} />}
              </Field>
              <Field label="Password" error={formState.errors.password?.message}>
                {(a) => <Input {...a} type="password" autoComplete="current-password" {...register('password')} />}
              </Field>
              <div className="-mt-2 mb-5 text-right">
                <Link to="/forgot-password" className="text-xs font-semibold text-mint-soft hover:underline">
                  Forgot your password?
                </Link>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-sage">
              New here?{' '}
              <Link to="/register" className="font-semibold text-mint-soft hover:underline">
                Create an account
              </Link>
            </p>
          </>
        )}
      </Panel>
    </AuthLayout>
  );
}

/** Second step: a 6-digit authenticator code, or one of the single-use backup codes. */
function TwoFactorStep({ onDone, onBack }: { onDone: () => Promise<void>; onBack: () => void }) {
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clean = code.trim();
      await unwrap(
        mode === 'totp'
          ? authClient.twoFactor.verifyTotp({ code: clean.replace(/\s/g, '') })
          : authClient.twoFactor.verifyBackupCode({ code: clean }),
      );
      await onDone();
    } catch (err) {
      setError(errorMessage(err, "That code didn't work. Try again."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Eyebrow>Two-step verification</Eyebrow>
      <h1 className="mt-2 mb-2 text-2xl font-bold">{mode === 'totp' ? 'Enter your authenticator code' : 'Use a backup code'}</h1>
      <p className="mb-5 text-sm text-sage">
        {mode === 'totp'
          ? 'Open your authenticator app and enter the 6-digit code for MuzikHub.'
          : 'Each backup code works once. You received them when you set up two-step verification.'}
      </p>
      <FormError message={error} />
      <Field label={mode === 'totp' ? 'Authentication code' : 'Backup code'}>
        {(a) => (
          <Input
            {...a}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            autoFocus
            maxLength={mode === 'totp' ? 7 : 32}
            placeholder={mode === 'totp' ? '123456' : 'xxxxx-xxxxx'}
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={busy || code.trim().length < 6}>
        {busy ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      <div className="mt-4 flex justify-between text-xs">
        <button
          type="button"
          className="font-semibold text-mint-soft hover:underline"
          onClick={() => {
            setMode(mode === 'totp' ? 'backup' : 'totp');
            setCode('');
            setError(null);
          }}
        >
          {mode === 'totp' ? 'Lost your device? Use a backup code' : 'Use your authenticator app'}
        </button>
        <button type="button" className="text-sage hover:text-foreground" onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}
