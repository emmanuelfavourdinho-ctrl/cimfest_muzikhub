import { useQuery } from '@tanstack/react-query';
import { capabilitiesSchema } from '@muzikhub/shared';
import { request } from './api';

export const capabilityKeys = { all: ['capabilities'] as const };

/**
 * Whether email works on this deployment (GET /api/v1/capabilities).
 *  - "available" / "unavailable": the server said so.
 *  - "unknown": still loading, or the check failed (e.g. offline). Never treated as available:
 *    screens that depend on email show a retry instead of a form, and never claim anything was sent.
 */
export type EmailState = 'available' | 'unavailable' | 'unknown';

export function useEmailCapability() {
  const q = useQuery({
    queryKey: capabilityKeys.all,
    queryFn: ({ signal }) => request('/capabilities', capabilitiesSchema, { signal }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const email: EmailState = q.data ? (q.data.email.available ? 'available' : 'unavailable') : 'unknown';
  return { email, isPending: q.isPending, isError: q.isError, error: q.error, refetch: q.refetch };
}
