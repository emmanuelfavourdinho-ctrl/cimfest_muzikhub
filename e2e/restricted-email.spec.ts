import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Restricted-email mode in the browser. The server side (503 EMAIL_UNAVAILABLE, identical for every
 * address, sign-up sends nothing) is covered by apps/api/src/lib/restricted-email.test.ts; here the
 * capabilities response is set per test so every screen can be checked against one API.
 */
const WEB = 'http://localhost:5273';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const UNAVAILABLE = { email: { available: false, unavailableFeatures: ['password-reset', 'email-verification'] } };

async function emailUnavailable(page: Page) {
  await page.route('**/api/v1/capabilities', (route) => route.fulfill({ json: UNAVAILABLE }));
}
async function capabilitiesFail(page: Page) {
  await page.route('**/api/v1/capabilities', (route) => route.abort('internetdisconnected'));
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

test.describe('restricted-email mode', () => {
  test('password recovery explains itself and offers nothing that cannot work', async ({ page }) => {
    await emailUnavailable(page);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByText(/password reset by email isn’t available/)).toBeVisible();
    await expect(page.getByText('nothing has been sent', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send reset link' })).toHaveCount(0);
    await expect(page.getByText(/we've sent a link/i)).toHaveCount(0);
    await axeClean(page, 'forgot password (restricted)');
    await noOverflow(page);

    // A reset page without a delivered link can't offer "Request a new link".
    await page.goto('/reset-password');
    await expect(page.getByText('This reset link is invalid or has expired.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new link' })).toHaveCount(0);
    await expect(page.getByText(/password reset by email isn’t available/)).toBeVisible();
  });

  test('registration warns to keep the password safe; the banner claims nothing was sent and offers no resend', async ({ page }) => {
    await emailUnavailable(page);
    await page.goto('/register');
    await page.getByRole('button', { name: /Artist or creator/ }).click();
    await expect(
      page.getByText(/we can’t confirm your address or help you reset a forgotten password\. Keep your password somewhere safe\./),
    ).toBeVisible();
    await axeClean(page, 'register (restricted)');

    // Sign up through the API (the form itself is covered by registration.spec), then look at the app.
    const username = `restricted.${uid()}`;
    const res = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: WEB },
      data: {
        name: 'Restricted Tester',
        username,
        email: `${username}@example.test`,
        password: 'correct-horse-battery',
        primaryUse: 'PROFESSIONAL',
      },
    });
    expect(res.status()).toBe(200);
    await page.request.post('/api/v1/me/onboarding/complete');
    await page.goto('/home');
    await expect(page.getByText('Your email isn’t confirmed.')).toBeVisible();
    await expect(page.getByText(/Email confirmation isn’t available on MuzikHub yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Resend/ })).toHaveCount(0);
    await expect(page.getByText(/We sent a link/)).toHaveCount(0);
    await axeClean(page, 'home banner (restricted)');
    await noOverflow(page);

    // Organiser access explains why a confirmed email can't be met yet.
    await page.goto('/opportunities/new');
    await expect(page.getByRole('heading', { name: 'Organiser access needed' })).toBeVisible();
    await expect(
      page.getByText(/a confirmed email address, which can’t be completed yet because email isn’t set up on MuzikHub/),
    ).toBeVisible();
    await page.goto('/competitions/new');
    await expect(page.getByRole('heading', { name: 'Organiser access needed' })).toBeVisible();
    await expect(page.getByText(/Running competitions needs .*can’t be completed yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await axeClean(page, 'organiser access (restricted)');
  });

  test('if the capability check fails, nothing assumes email works', async ({ page }) => {
    await capabilitiesFail(page);
    await page.goto('/forgot-password');
    await expect(page.getByText("We couldn't check whether password reset is available.", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toHaveCount(0);

    // Once the check succeeds (email available), the normal form appears.
    await page.unroute('**/api/v1/capabilities');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  });

  test('normal mode is unchanged: the real API reports email available and the reset form works', async ({ page }) => {
    const caps = await page.request.get('/api/v1/capabilities');
    expect(await caps.json()).toEqual({ email: { available: true, unavailableFeatures: [] } });
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(`nobody.${uid()}@example.test`);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/If an account exists for/)).toBeVisible();
  });
});
