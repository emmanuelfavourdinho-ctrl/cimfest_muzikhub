import type { Request, RequestHandler } from 'express';
import { can, FRESH_SESSION_MINUTES, type Permission } from '@muzikhub/shared';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';

export interface StaffContext {
  id: string;
  role: 'MODERATOR' | 'ADMIN';
  sessionCreatedAt: Date;
  ip: string | null;
}

declare module 'express-serve-static-core' {
  interface Locals {
    staff?: StaffContext;
  }
}

export const clientIp = (req: Request) => req.ip ?? null;

/**
 * Admin Console gate. Mount after requireAuth. The role is re-read from the database on every
 * request (never trusted from the session or the browser), so a demotion takes effect at once.
 * Staff must be ACTIVE and have two-factor authentication enabled (approved 2026-11-24).
 */
export const requireStaff: RequestHandler = async (req, res, next) => {
  const session = res.locals.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'You must be signed in');
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true, status: true, twoFactorEnabled: true },
  });
  if (!user || !can(user.platformRole, 'admin.access')) {
    throw new HttpError(403, 'NOT_STAFF', 'You do not have access to the Admin Console');
  }
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Staff accounts must be active to use the Admin Console');
  }
  if (!user.twoFactorEnabled) {
    throw new HttpError(403, 'TWO_FACTOR_REQUIRED', 'Set up two-factor authentication to use the Admin Console');
  }
  res.locals.staff = {
    id: session.user.id,
    role: user.platformRole as StaffContext['role'],
    sessionCreatedAt: new Date(session.session.createdAt),
    ip: clientIp(req),
  };
  next();
};

export function staffOf(locals: { staff?: StaffContext }): StaffContext {
  if (!locals.staff) throw new HttpError(403, 'NOT_STAFF', 'You do not have access to the Admin Console');
  return locals.staff;
}

/** Throws 403 unless the staff member's role grants the permission. */
export function assertCan(staff: StaffContext, permission: Permission) {
  if (!can(staff.role, permission)) {
    throw new HttpError(403, 'FORBIDDEN', 'Your role does not allow this action');
  }
}

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (_req, res, next) => {
    assertCan(staffOf(res.locals), permission);
    next();
  };

/**
 * Sensitive actions (ban, reinstating a ban, role changes, two-factor resets) need a session
 * that was started recently — i.e. the person just proved they have the password and the
 * second factor. Otherwise: 403 REAUTH_REQUIRED and the console asks them to sign in again.
 */
export function assertFreshSession(staff: StaffContext) {
  const ageMs = Date.now() - staff.sessionCreatedAt.getTime();
  if (ageMs > FRESH_SESSION_MINUTES * 60_000) {
    throw new HttpError(
      403,
      'REAUTH_REQUIRED',
      `For your security, sign in again to do this (required every ${FRESH_SESSION_MINUTES} minutes for sensitive actions).`,
    );
  }
}
