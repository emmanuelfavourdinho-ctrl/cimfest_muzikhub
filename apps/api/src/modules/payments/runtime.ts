import { env } from '../../config/env.js';
import type { PaymentProvider } from './provider.js';
import { FakePaymentProvider } from './providers/fake.js';
import { NotchPayProvider } from './providers/notchpay.js';

/**
 * Which payment mode and provider this API instance runs with. Built once from the validated
 * environment (config/env.ts refuses unsafe combinations at startup); tests swap it with
 * configurePayments(), the same pattern as setMediaStorage().
 */
export type PaymentsMode = 'off' | 'sandbox' | 'live';
export interface PaymentsRuntime {
  mode: PaymentsMode;
  provider: PaymentProvider | null;
}

/** Where the customer comes back after paying. Server configuration only, never client input. */
export const RETURN_PATH = '/checkout/return';
export const DEV_CHECKOUT_PATH = '/dev/payments/checkout';

export function createProvider(name: 'fake' | 'notchpay', nodeEnv: string = env.NODE_ENV): PaymentProvider {
  if (name === 'fake') {
    // Defence in depth: env validation already refuses this combination.
    if (nodeEnv === 'production') throw new Error('The TEST PROVIDER is refused in production');
    return new FakePaymentProvider({ checkoutBaseUrl: new URL(DEV_CHECKOUT_PATH, env.WEB_APP_URL).toString() });
  }
  return new NotchPayProvider();
}

let runtime: PaymentsRuntime | null = null;

export function paymentsRuntime(): PaymentsRuntime {
  runtime ??= {
    mode: env.PAYMENTS_MODE,
    provider: env.PAYMENTS_MODE === 'off' ? null : createProvider(env.PAYMENTS_PROVIDER),
  };
  return runtime;
}

/** Tests (and only tests) replace the runtime. */
export function configurePayments(next: PaymentsRuntime) {
  runtime = next;
}

/** The development-only sandbox page and its helper routes exist only in this configuration. */
export function devSandboxEnabled(): boolean {
  const r = paymentsRuntime();
  return env.NODE_ENV !== 'production' && r.mode === 'sandbox' && r.provider?.name === 'fake';
}

export const callbackUrl = (reference: string) => {
  const url = new URL(RETURN_PATH, env.WEB_APP_URL);
  url.searchParams.set('reference', reference);
  return url.toString();
};
