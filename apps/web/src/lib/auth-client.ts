import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient, usernameClient } from 'better-auth/client/plugins';
import { API_BASE } from './api';

/**
 * Talks to Better Auth at /api/auth/*. The session lives in an HTTP-only cookie
 * set by the API — the browser JavaScript never sees or stores a token.
 */
export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  plugins: [
    usernameClient(),
    twoFactorClient(),
    inferAdditionalFields({ user: { primaryUse: { type: 'string', required: true } } }),
  ],
});

/** Better Auth returns `{ data, error }` instead of throwing; this turns errors into exceptions. */
export async function unwrap<T>(
  promise: Promise<{ data: T; error: null } | { data: null; error: { message?: string; status: number } }>,
): Promise<T> {
  const result = await promise;
  if (result.error) {
    if (result.error.status === 429) throw new Error('Too many attempts. Please wait a minute and try again.');
    throw new Error(result.error.message || 'Something went wrong. Please try again.');
  }
  return result.data as T;
}
