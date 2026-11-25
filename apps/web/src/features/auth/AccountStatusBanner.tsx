import { ShieldAlert } from 'lucide-react';
import { useMe } from '@/lib/queries';

/**
 * Explains a RESTRICTED account (approved 2026-11-24): the person can still browse, but the
 * server refuses publishing and interacting. Shows the reason recorded by the moderator.
 */
export function AccountStatusBanner() {
  const { data: me } = useMe();
  if (!me || me.accountStatus !== 'RESTRICTED') return null;
  return (
    <div role="status" className="mb-5 flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-danger">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <p>
        <strong className="font-semibold">Your account is restricted.</strong> You can browse MuzikHub, but you can't post, comment, like,
        follow, connect or edit your profile right now.
        {me.statusReason && (
          <>
            {' '}
            Reason: <span className="italic">{me.statusReason}</span>
          </>
        )}
      </p>
    </div>
  );
}
