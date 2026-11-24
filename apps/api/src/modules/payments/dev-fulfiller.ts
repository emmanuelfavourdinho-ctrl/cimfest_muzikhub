import { fulfillerFor, registerFulfiller } from './fulfilment.js';

/**
 * DEVELOPMENT SANDBOX ONLY: lets a TEST_ITEM order on /dev/payments reach FULFILLED. It grants
 * NOTHING (no entitlement row). Registered by app.ts only when devSandboxEnabled() — never in
 * production — and only if tests haven't registered their own TEST_ITEM fulfiller.
 */
export function registerDevSandboxFulfiller() {
  if (fulfillerFor('TEST_ITEM')) return;
  registerFulfiller('TEST_ITEM', {
    key: 'dev-sandbox-noop',
    async fulfil() {
      return { entitlementType: null, entitlementId: null };
    },
  });
}
