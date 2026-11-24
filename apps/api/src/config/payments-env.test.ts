import { describe, expect, it } from 'vitest';
import { createProvider } from '../modules/payments/runtime.js';
import { parseEnvironment } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5435/muzikhub',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'https://api.muzikhub.test',
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_fake_key_for_tests',
  EMAIL_FROM: 'MuzikHub <no-reply@mail.muzikhub.test>',
};
const problems = (source: Record<string, string>) => {
  const r = parseEnvironment(source);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('PAYMENTS_MODE startup rules', () => {
  it('defaults to off, with the TEST PROVIDER outside production and Notch Pay in production', () => {
    const dev = parseEnvironment({ ...base, NODE_ENV: 'development' });
    const p = parseEnvironment(prod);
    expect(dev.success && [dev.data.PAYMENTS_MODE, dev.data.PAYMENTS_PROVIDER]).toEqual(['off', 'fake']);
    expect(p.success && [p.data.PAYMENTS_MODE, p.data.PAYMENTS_PROVIDER]).toEqual(['off', 'notchpay']);
  });
  it('rejects unknown modes', () => {
    expect(parseEnvironment({ ...base, PAYMENTS_MODE: 'on' }).success).toBe(false);
  });
  it('production refuses the fake provider, whatever the mode', () => {
    for (const mode of ['off', 'sandbox']) {
      expect(problems({ ...prod, PAYMENTS_PROVIDER: 'fake', PAYMENTS_MODE: mode, PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION: 'true' })).toContain(
        'PAYMENTS_PROVIDER=fake (the TEST PROVIDER) is refused in production',
      );
    }
    expect(() => createProvider('fake', 'production')).toThrow(/refused in production/);
  });
  it('sandbox in production needs the explicit override', () => {
    expect(problems({ ...prod, PAYMENTS_MODE: 'sandbox' }).join()).toMatch(/PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION=true/);
    expect(problems({ ...prod, PAYMENTS_MODE: 'sandbox', PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION: 'true' })).toEqual([]);
    expect(problems({ ...base, NODE_ENV: 'development', PAYMENTS_MODE: 'sandbox' })).toEqual([]);
  });
  it('live is unreachable until approved, and also needs Notch Pay and its keys', () => {
    const p = problems({ ...prod, PAYMENTS_MODE: 'live' });
    expect(p).toContain('PAYMENTS_MODE=live is not approved yet (owner sign-off required; see ADR 0004)');
    expect(p).toEqual(
      expect.arrayContaining(['PAYMENTS_MODE=live requires NOTCHPAY_PRIVATE_KEY', 'PAYMENTS_MODE=live requires NOTCHPAY_WEBHOOK_SECRET']),
    );
    const withKeys = problems({
      ...prod,
      PAYMENTS_MODE: 'live',
      NOTCHPAY_PUBLIC_KEY: 'k1',
      NOTCHPAY_PRIVATE_KEY: 'k2',
      NOTCHPAY_WEBHOOK_SECRET: 'k3',
    });
    expect(withKeys).toEqual(['PAYMENTS_MODE=live is not approved yet (owner sign-off required; see ADR 0004)']);
  });
  it('messages never echo values', () => {
    const r = parseEnvironment({ ...prod, PAYMENTS_MODE: 'live', NOTCHPAY_PRIVATE_KEY: 'sk_secret_value_123' });
    expect(JSON.stringify(r.success ? {} : r.error.issues.map((i) => i.message))).not.toContain('sk_secret_value_123');
  });
});
