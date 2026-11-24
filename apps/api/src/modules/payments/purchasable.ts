import { SELLABLE_PRODUCTS, type BillingProduct as SharedProduct } from '@muzikhub/shared';
import { env } from '../../config/env.js';
import type { BillingProduct } from '../../generated/prisma/client.js';
import { fulfillerFor } from './fulfilment.js';
import type { PaymentsMode } from './runtime.js';

/**
 * Can this catalogue row be bought right now? One rule for checkout AND the pricing page.
 *  - off:     nothing.
 *  - sandbox: TEST MONEY ONLY. A product is buyable when something can deliver it (a fulfiller is
 *             registered, i.e. its benefits are built). Test-only rows never in production.
 *  - live:    real money — only owner-approved products (SELLABLE_PRODUCTS, empty today) that an
 *             admin put on sale. Unreachable anyway while live mode is not approved.
 */
export function isPurchasable(item: { product: BillingProduct; active: boolean; testOnly: boolean }, mode: PaymentsMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'live')
    return (
      item.active && !item.testOnly && SELLABLE_PRODUCTS.includes(item.product as SharedProduct) && Boolean(fulfillerFor(item.product))
    );
  if (item.testOnly) return env.NODE_ENV !== 'production';
  return Boolean(fulfillerFor(item.product));
}
