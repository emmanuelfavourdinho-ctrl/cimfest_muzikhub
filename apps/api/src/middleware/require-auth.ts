import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { hasFullAccess, isVisibleStatus } from '../lib/account-status.js';
import { auth, type AuthSession } from '../lib/auth.js';
import { HttpError } from '../lib/http-error.js';

declare module 'express-serve-static-core' {
  interface Locals {
    session?: AuthSession;
  }
}

/**
 * Rejects the request with 401 unless it carries a valid Better Auth session, and 403 if the
 * account has since been suspended, banned or deactivated. RESTRICTED accounts pass (they may
 * sign in and browse); actions that publish or interact also use requireFullAccess.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'You must be signed in');
  }
  if (!isVisibleStatus(session.user.status)) {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active');
  }
  res.locals.session = session;
  next();
};

/**
 * For actions that publish, interact, message or collaborate. RESTRICTED accounts are
 * read-only (approved 2026-11-24). Mount after requireAuth.
 */
export const requireFullAccess: RequestHandler = (_req, res, next) => {
  const status = res.locals.session?.user.status;
  if (!status || !hasFullAccess(status)) {
    throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Your account is restricted: you can browse, but not post or interact.');
  }
  next();
};

/** For handlers mounted after requireAuth: the session is guaranteed to exist. */
export function currentUserId(locals: { session?: AuthSession }): string {
  if (!locals.session) throw new HttpError(401, 'UNAUTHENTICATED', 'You must be signed in');
  return locals.session.user.id;
}

/**
 * For public endpoints that behave differently for the signed-in owner (e.g. showing
 * their own drafts). Never rejects; sets res.locals.session only for a visible account.
 */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (session && isVisibleStatus(session.user.status)) res.locals.session = session;
  next();
};

export function viewerId(locals: { session?: AuthSession }): string | null {
  return locals.session?.user.id ?? null;
}
