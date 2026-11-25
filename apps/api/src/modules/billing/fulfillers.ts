import { dbNow } from '../../lib/db-time.js';
import { fulfillerFor, registerFulfiller, type Fulfiller } from '../payments/fulfilment.js';
import { grantSubscription } from './entitlements.js';

/**
 * Real fulfillers for subscription products: a verified, paid order becomes a subscription period
 * via the ONE entitlements service (extend / upgrade now / downgrade later — no proration).
 * Promotions register theirs in promotions/fulfillers.ts.
 */
const subscription = (plan: 'CREATOR_PLUS' | 'PRO'): Fulfiller => ({
  key: `subscription-${plan.toLowerCase()}-v1`,
  async fulfil(tx, order) {
    const sub = await grantSubscription(tx, order.userId, plan, order.durationDays, await dbNow(tx));
    return { entitlementType: 'SUBSCRIPTION', entitlementId: sub.id };
  },
});

export function registerSubscriptionFulfillers() {
  if (!fulfillerFor('CREATOR_PLUS')) registerFulfiller('CREATOR_PLUS', subscription('CREATOR_PLUS'));
  if (!fulfillerFor('PRO')) registerFulfiller('PRO', subscription('PRO'));
}
