import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { PASSWORD_MAX, PASSWORD_MIN } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Eyebrow, Hint, Panel } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { authClient, unwrap } from '@/lib/auth-client';
import { AuthLayout } from './AuthLayout';

const emailSchema = z.object({ email: z.email('Enter a valid email address').trim() });

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await unwrap(authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` }));
      setSentTo(email);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <Panel className="p-5 sm:p-7">
        <Eyebrow>Account recovery</Eyebrow>
        <h1 className="mt-2 mb-2 text-2xl font-bold">Reset your password</h1>
        {sentTo ? (
          <>
            {/* The same message whether or not the account exists, so emails can't be probed. */}
            <Hint className="mt-4">
              If an account exists for <strong>{sentTo}</strong>, we've sent a link to reset its password. The link expires in 1 hour.
            </Hint>
            <Button asChild variant="outline" className="mt-5 w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <p className="mb-5 text-sm text-sage">Enter the email address on your account and we'll send you a reset link.</p>
            <FormError message={formError} />
            <Field label="Email" error={formState.errors.email?.message}>
              {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register('email')} />}
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <p className="mt-6 text-center text-sm">
              <Link to="/login" className="font-semibold text-mint-soft hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </Panel>
    </AuthLayout>
  );
}

const newPasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const linkError = params.get('error');
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return;
    setFormError(null);
    try {
      await unwrap(authClient.resetPassword({ newPassword: password, token }));
      toast.success('Password updated. Sign in with your new password.');
      void navigate('/login', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <Panel className="p-5 sm:p-7">
        <Eyebrow>Account recovery</Eyebrow>
        <h1 className="mt-2 mb-5 text-2xl font-bold">Choose a new password</h1>
        {!token || linkError ? (
          <>
            <FormError message="This reset link is invalid or has expired." />
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <FormError message={formError} />
            <Field label="New password" error={formState.errors.password?.message} hint={`At least ${PASSWORD_MIN} characters.`}>
              {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password')} />}
            </Field>
            <Field label="Confirm new password" error={formState.errors.confirm?.message}>
              {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('confirm')} />}
            </Field>
            <p className="mb-4 text-xs text-sage-dim">For your security, you'll be signed out on all other devices.</p>
            <Button type="submit" size="lg" className="w-full" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        )}
      </Panel>
    </AuthLayout>
  );
}
