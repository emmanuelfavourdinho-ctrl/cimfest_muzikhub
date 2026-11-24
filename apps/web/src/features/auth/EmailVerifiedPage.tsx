import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/primitives';
import { queryKeys, useMe } from '@/lib/queries';
import { AuthLayout } from './AuthLayout';

/**
 * Where verification links return (the API redirects here). Better Auth appends
 * ?error=… when the link is invalid or expired; otherwise the email is now confirmed.
 */
export function EmailVerifiedPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const qc = useQueryClient();
  const { data: me } = useMe();

  useEffect(() => {
    // The account changed server-side (and the user may now be signed in).
    void qc.invalidateQueries({ queryKey: queryKeys.me });
  }, [qc]);

  return (
    <AuthLayout>
      <Panel className="p-6 text-center sm:p-8">
        {error ? (
          <>
            <CircleAlert className="mx-auto mb-3 size-10 text-gold" aria-hidden />
            <h1 className="text-2xl font-bold">This link didn't work</h1>
            <p className="mt-2 mb-6 text-sm text-sage">
              It may have expired (links last 1 hour) or already been used. {me ? 'You can request a new one from the banner on your home page.' : 'Sign in to request a new one.'}
            </p>
            <Button asChild>
              <Link to={me ? '/home' : '/login'}>{me ? 'Go to MuzikHub' : 'Sign in'}</Link>
            </Button>
          </>
        ) : (
          <>
            <CircleCheck className="mx-auto mb-3 size-10 text-emerald" aria-hidden />
            <h1 className="text-2xl font-bold">Email confirmed</h1>
            <p className="mt-2 mb-6 text-sm text-sage">Thanks — your email address is verified.</p>
            <Button asChild>
              <Link to={me ? '/home' : '/login'}>{me ? 'Continue to MuzikHub' : 'Sign in'}</Link>
            </Button>
          </>
        )}
      </Panel>
    </AuthLayout>
  );
}
