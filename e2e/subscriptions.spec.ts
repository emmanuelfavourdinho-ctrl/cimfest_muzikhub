import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function signUp(request: APIRequestContext, name: string) {
  const username = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${uid()}`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name, username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse: 'CREATOR' },
  });
  expect(res.status()).toBe(200);
  await request.post('/api/v1/me/onboarding/complete');
  return { username };
}
async function axeClean(page: Page, what: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    what,
  ).toEqual([]);
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `no horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

/**
 * Plays the payment provider's part. The fake hosted page exists only in development builds, so
 * the test does what the provider would: record the outcome and send a signed webhook (the API's
 * dev-only sandbox route), then the customer lands on our real return page.
 */
async function payAtProvider(page: Page, outcome: 'paid' | 'failed') {
  await page.waitForURL(/\/dev\/payments\/checkout\?reference=/);
  const reference = new URL(page.url()).searchParams.get('reference')!;
  const res = await page.request.post(`/api/v1/dev/payments/orders/${reference}/settle`, { headers: { Origin: WEB }, data: { outcome } });
  expect(res.status()).toBe(200);
  await page.goto(`/checkout/return?reference=${reference}`);
  return reference;
}

test('subscription: choose a plan, pay with the TEST PROVIDER, get the benefits, manage it', async ({ page }) => {
  test.setTimeout(120_000);
  const me = await signUp(page.request, 'Plan Buyer');

  // Pricing → review (server-computed preview) → provider.
  await page.goto('/pricing');
  await page.getByRole('region', { name: 'Creator Plus' }).getByRole('link', { name: 'Choose Creator Plus' }).click();
  await expect(page.getByRole('heading', { name: 'Review your plan' })).toBeVisible();
  await expect(page.getByText('Test payments.')).toBeVisible();
  await expect(page.getByText(/Starts now and ends on/)).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'checkout review');
  await page.getByRole('button', { name: /Continue to payment/ }).click();

  // Back from the provider: our own status only, until verified fulfilment.
  const reference = await payAtProvider(page, 'paid');
  const status = page.getByRole('region', { name: 'Order status' });
  await expect(status).toContainText('Paid', { timeout: 20_000 });
  await expect(status).toContainText('Your purchase is active');
  await noOverflow(page);
  await axeClean(page, 'checkout return');

  // Receipt (on screen only).
  await page.getByRole('link', { name: 'View receipt' }).click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await expect(page.getByText(reference)).toBeVisible();
  await expect(page.getByText('TEST PROVIDER', { exact: true })).toBeVisible();
  await axeClean(page, 'receipt');

  // A real benefit: the profile accent.
  await page.goto('/settings/profile');
  await page.getByRole('radio', { name: 'Violet' }).click();
  await page.getByRole('button', { name: 'Save accent' }).click();
  await expect(page.getByText('Accent saved')).toBeVisible();
  await page.goto(`/u/${me.username}`);
  await expect(page.locator('[data-accent="VIOLET"]')).toHaveCount(1);

  // Billing: active plan with dates; cancel keeps it to the end date.
  await page.goto('/settings/billing');
  await expect(page.getByRole('heading', { name: 'Creator Plus' })).toBeVisible();
  await expect(page.getByText('Paid until')).toBeVisible();
  await expect(page.getByText('Creator Plus, Monthly')).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'billing');
  await page.getByRole('button', { name: 'Cancel plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel plan' }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('Ends', { exact: true })).toBeVisible();

  // Notifications come from the real events.
  await page.goto('/notifications');
  await expect(page.getByText('Test payment: payment confirmed')).toBeVisible();
  await expect(page.getByText('Cancellation confirmed')).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'notifications');
});

test('subscription: a failed payment activates nothing', async ({ page }) => {
  await signUp(page.request, 'Unlucky Buyer');
  await page.goto('/billing/checkout?product=PRO&option=MONTHLY');
  await page.getByRole('button', { name: /Continue to payment/ }).click();
  await payAtProvider(page, 'failed');
  await expect(page.getByRole('region', { name: 'Order status' })).toContainText('Failed', { timeout: 20_000 });
  const ent = await (await page.request.get('/api/v1/billing/entitlements')).json();
  expect(ent.plan).toBe('FREE');
});
