import type { BillingProduct, Prisma } from '../../generated/prisma/client.js';

/**
 * Fulfilment registry, keyed by product type. Phase 3 registers nothing in production code: only
 * tests register a TEST_ITEM fulfiller. Subscriptions (Phase 5) and promotions (Phase 4) add
 * themselves here. An order whose product has no fulfiller stays FULFILMENT_PENDING (retried,
 * visible to admins), never silently dropped.
 */
export interface FulfilmentResult {
  entitlementType: 'SUBSCRIPTION' | 'PROMOTION' | null;
  entitlementId: string | null;
}
export interface Fulfiller {
  key: string;
  fulfil(
    tx: Prisma.TransactionClient,
    order: { id: string; userId: string; product: BillingProduct; durationDays: number },
  ): Promise<FulfilmentResult>;
}

const registry = new Map<BillingProduct, Fulfiller>();

export function registerFulfiller(product: BillingProduct, fulfiller: Fulfiller) {
  if (registry.has(product)) throw new Error(`fulfiller already registered for ${product}`);
  registry.set(product, fulfiller);
}
export const fulfillerFor = (product: BillingProduct) => registry.get(product);
/** Tests only. */
export function clearFulfillers() {
  registry.clear();
}
