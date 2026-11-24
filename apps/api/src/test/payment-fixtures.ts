import { grantSubscription } from '../modules/billing/entitlements.js';
import { clearFulfillers, registerFulfiller } from '../modules/payments/fulfilment.js';
import { FakePaymentProvider } from '../modules/payments/providers/fake.js';
import { configurePayments } from '../modules/payments/runtime.js';
import { registerSubscriptionFulfillers } from '../modules/billing/fulfillers.js';

/**
 * TEST-ONLY fulfiller for TEST_ITEM orders (Phase 3 ships no real fulfillers). It grants a
 * Creator Plus period so refunds can be tested end to end against real entitlement rows.
 * `failuresLeft` makes it throw N times first (fulfilment-failure-then-retry tests).
 */
export const testFulfiller = {
  key: 'test-item-v1',
  failuresLeft: 0,
  calls: 0,
  async fulfil(tx: Parameters<typeof grantSubscription>[0], order: { userId: string; durationDays: number }) {
    testFulfiller.calls += 1;
    if (testFulfiller.failuresLeft > 0) {
      testFulfiller.failuresLeft -= 1;
      throw new Error('test fulfiller: simulated failure');
    }
    const sub = await grantSubscription(tx, order.userId, 'CREATOR_PLUS', order.durationDays);
    return { entitlementType: 'SUBSCRIPTION' as const, entitlementId: sub.id };
  },
};

export function useSandboxPayments({ supportsRefund = true } = {}) {
  const fake = new FakePaymentProvider({ checkoutBaseUrl: 'http://localhost:5173/dev/payments/checkout', supportsRefund });
  configurePayments({ mode: 'sandbox', provider: fake });
  clearFulfillers();
  registerSubscriptionFulfillers();
  registerFulfiller('TEST_ITEM', testFulfiller);
  testFulfiller.failuresLeft = 0;
  testFulfiller.calls = 0;
  return fake;
}
