import { Link } from 'react-router';
import { MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/primitives';

/** Shared wording for restricted-email mode, so every screen says the same honest thing. */
export const EMAIL_UNAVAILABLE_TEXT = {
  recovery:
    'Email isn’t set up on MuzikHub yet, so password reset by email isn’t available. We can’t send a reset link, and nothing has been sent.',
  lockedOut:
    'If you can’t sign in, contact MuzikHub. For your security we can’t reset a password without a way to prove the account is yours.',
  register:
    'Email isn’t set up on MuzikHub yet, so we can’t confirm your address or help you reset a forgotten password. Keep your password somewhere safe.',
  confirmation: 'Email confirmation isn’t available on MuzikHub yet. Features that need a confirmed email will open once it is.',
  verifiedEmailBlocked: 'a confirmed email address, which can’t be completed yet because email isn’t set up on MuzikHub',
} as const;

/** Explains that password recovery is unavailable. No form, no action that can't work. */
export function RecoveryUnavailable() {
  return (
    <>
      <div className="mt-4 flex gap-3 rounded-xl border border-warning/40 bg-warning/15 px-4 py-3 text-sm text-warning" role="status">
        <MailX className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>{EMAIL_UNAVAILABLE_TEXT.recovery}</p>
      </div>
      <Hint className="mt-4">
        {EMAIL_UNAVAILABLE_TEXT.lockedOut}{' '}
        <Link to="/contact" className="font-semibold text-signal hover:underline">
          Contact
        </Link>
      </Hint>
      <Button asChild variant="outline" className="mt-5 w-full">
        <Link to="/login">Back to sign in</Link>
      </Button>
    </>
  );
}
