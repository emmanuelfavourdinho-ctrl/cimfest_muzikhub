import { dbNow } from '../../lib/db-time.js';
import { grantPromotion } from '../billing/entitlements.js';
import { FulfilmentImpossible, fulfillerFor, registerFulfiller, type Fulfiller } from '../payments/fulfilment.js';
import { visibleUser } from '../../lib/account-status.js';

/**
 * Post Boost / Profile Spotlight fulfillers: a verified, paid order becomes a promotion period via
 * the entitlements service (one per target; buying again extends, never overlaps). If the target
 * can no longer be promoted (post removed, account not active), nothing is granted and the order
 * goes to NEEDS_REVIEW for a refund.
 */
const promotion = (product: 'POST_BOOST' | 'PROFILE_SPOTLIGHT'): Fulfiller => ({
  key: `${product.toLowerCase()}-v1`,
  async fulfil(tx, order) {
    if (!order.targetId) throw new FulfilmentImpossible('promotion order without a target');
    if (product === 'POST_BOOST') {
      const post = await tx.post.findFirst({
        where: { id: order.targetId, removedAt: null, author: visibleUser },
        select: { authorId: true },
      });
      if (!post || post.authorId !== order.userId) throw new FulfilmentImpossible('the post is gone, removed or no longer yours');
    } else {
      const user = await tx.user.findFirst({ where: { id: order.targetId, ...visibleUser }, select: { id: true } });
      if (!user || user.id !== order.userId) throw new FulfilmentImpossible('the profile is not available');
    }
    const p = await grantPromotion(tx, order.userId, product, order.targetId, order.durationDays, await dbNow(tx));
    return { entitlementType: 'PROMOTION', entitlementId: p.id };
  },
});

export function registerPromotionFulfillers() {
  if (!fulfillerFor('POST_BOOST')) registerFulfiller('POST_BOOST', promotion('POST_BOOST'));
  if (!fulfillerFor('PROFILE_SPOTLIGHT')) registerFulfiller('PROFILE_SPOTLIGHT', promotion('PROFILE_SPOTLIGHT'));
}
