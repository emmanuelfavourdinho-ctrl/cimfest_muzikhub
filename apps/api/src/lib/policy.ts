import { can } from '@muzikhub/shared';
import type { StaffContext } from '../middleware/require-staff.js';
import { HttpError } from './http-error.js';

/**
 * Central authorisation policy for billing resources (subscriptions, promotions; orders and
 * payments in Phase 3). Every read or change of one of these goes through here.
 *
 * - The owner may read their own resource.
 * - Staff may read anyone's only through the Admin Console (2FA-checked StaffContext) and only
 *   with the `billing.view` permission.
 * - Everyone else gets 404, the same as "does not exist", so IDs can't be probed.
 */
export type BillingResource = { userId: string };

export function canReadBilling(actor: { userId: string } | null, resource: BillingResource, staff?: StaffContext): boolean {
  if (staff) return can(staff.role, 'billing.view');
  return Boolean(actor && actor.userId === resource.userId);
}

export function assertCanReadBilling<T extends BillingResource>(
  actor: { userId: string } | null,
  resource: T | null,
  opts: { staff?: StaffContext; notFound: string } = { notFound: 'Not found' },
): T {
  if (!actor && !opts.staff) throw new HttpError(401, 'UNAUTHENTICATED', 'You must be signed in');
  if (opts.staff && !can(opts.staff.role, 'billing.view')) throw new HttpError(403, 'FORBIDDEN', "Your role can't view billing records");
  if (!resource || !canReadBilling(actor, resource, opts.staff)) throw new HttpError(404, 'NOT_FOUND', opts.notFound);
  return resource;
}
