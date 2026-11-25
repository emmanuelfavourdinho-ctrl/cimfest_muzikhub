import { useEffect, useState } from 'react';
import { MailCheck, MailX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { useEmailCapability } from '@/lib/capabilities';
import { useMe } from '@/lib/queries';
import { EMAIL_UNAVAILABLE_TEXT } from './EmailUnavailable';

const COOLDOWN_SECONDS = 60;

/**
 * Shown to signed-in users whose email isn't confirmed. Verification is optional at this
 * stage (approved 2026-11-24), so this informs and offers a resend — it never blocks.
 */
export function VerifyEmailBanner() {
  const { data: me } = useMe();
  const capability = useEmailCapability();
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!me || me.emailVerified) return null;
  // Until we know email works, claim nothing ("we sent a link") and offer no resend.
  if (capability.email === 'unknown') return null;
  if (capability.email === 'unavailable') {
    return (
      <div
        role="status"
        className="mb-5 flex items-start gap-3 rounded-xl border border-hairline-strong bg-surface-raised px-4 py-3 text-sm text-text-2"
      >
        <MailX className="mt-0.5 hidden size-5 shrink-0 text-text-3 sm:block" aria-hidden />
        <p className="flex-1">
          <strong className="font-semibold text-text-1">Your email isn’t confirmed.</strong> {EMAIL_UNAVAILABLE_TEXT.confirmation}
        </p>
      </div>
    );
  }

  async function resend() {
    if (!me) return;
    setSending(true);
    const { error } = await authClient.sendVerificationEmail({ email: me.email, callbackURL: `${window.location.origin}/email-verified` });
    setSending(false);
    if (error) {
      toast.error(
        error.status === 429 ? 'Please wait a few minutes before asking again.' : "Couldn't request a new link. Please try again.",
      );
      return;
    }
    setCooldown(COOLDOWN_SECONDS);
    // We know the request was accepted, not that the email arrived — say exactly that.
    toast.success(`We've asked for a new confirmation link to be sent to ${me.email}. Check your inbox and spam folder.`);
  }

  return (
    <div
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning sm:flex-row sm:items-center"
    >
      <MailCheck className="hidden size-5 shrink-0 text-warning sm:block" aria-hidden />
      <p className="flex-1">
        <strong className="font-semibold">Confirm your email.</strong> We sent a link to <span className="break-all">{me.email}</span>.
        Confirming helps you recover your account.
      </p>
      <Button variant="outline" size="sm" onClick={() => void resend()} disabled={sending || cooldown > 0}>
        {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
      </Button>
    </div>
  );
}
