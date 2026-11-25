import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { EMAIL_UNAVAILABLE_TEXT } from '@/features/auth/EmailUnavailable';
import { useEmailCapability } from '@/lib/capabilities';

type Missing = 'ADMIN_APPROVAL' | 'VERIFIED_EMAIL' | 'PROFESSIONAL_ACCOUNT';

const MISSING_TEXT: Record<Missing, string> = {
  ADMIN_APPROVAL: 'approval from a MuzikHub administrator',
  VERIFIED_EMAIL: 'a verified email address',
  PROFESSIONAL_ACCOUNT: 'an "Industry professional" account',
};

/** "Organiser access needed", explaining each missing requirement — honestly when email is unavailable. */
export function OrganiserAccessNeeded({ missing, what, back }: { missing: Missing[]; what: string; back: { to: string; label: string } }) {
  const { email } = useEmailCapability();
  const text = (m: Missing) =>
    m === 'VERIFIED_EMAIL' && email === 'unavailable' ? EMAIL_UNAVAILABLE_TEXT.verifiedEmailBlocked : MISSING_TEXT[m];
  return (
    <div className="mx-auto max-w-xl">
      <EmptyState
        title="Organiser access needed"
        action={
          <Button asChild variant="outline">
            <Link to={back.to}>{back.label}</Link>
          </Button>
        }
      >
        {what} needs {missing.map(text).join(', ')}.
      </EmptyState>
    </div>
  );
}
