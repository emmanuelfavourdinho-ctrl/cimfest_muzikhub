import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { PageLoading, Panel } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';

/**
 * UX-only gate: sends signed-out visitors to /login and back afterwards.
 * Real protection is the API returning 401 — this component only avoids showing
 * a page that would fail anyway.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isPending, isError, error, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <PageLoading />;
  if (isError) return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

/**
 * Signed-in users skip the auth pages. This also runs the moment a sign-in succeeds
 * (the cached user appears), so it must honour ?next= itself.
 */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const [params] = useSearchParams();
  if (isPending) return <PageLoading />;
  if (me) {
    const fallback = me.profile.onboardingCompletedAt ? '/home' : '/onboarding';
    return <Navigate to={safeNextPath(params.get('next')) ?? fallback} replace />;
  }
  return children;
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16">
      <Panel className="p-6 text-center">
        <h2 className="text-lg font-bold">We couldn't load this page</h2>
        <p className="mt-2 mb-5 text-sm text-sage">{message}</p>
        <Button onClick={onRetry}>Try again</Button>
      </Panel>
    </div>
  );
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}
