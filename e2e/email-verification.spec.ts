import { SignJWT } from 'jose';
import { expect, test } from '@playwright/test';

const WEB = 'http://localhost:5273';
const API = 'http://localhost:4100';
/** Must match BETTER_AUTH_SECRET given to the e2e API in playwright.config.ts (test-only value). */
const E2E_SECRET = 'e2e-only-secret-not-used-anywhere-real-0000000';

/**
 * The e2e API captures emails in memory (NODE_ENV=test), so the test builds the link the email
 * would contain: an HS256 token signed with the test secret, exactly like Better Auth's own.
 */
async function verificationLink(email: string, expiresInSeconds = 3600) {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(new TextEncoder().encode(E2E_SECRET));
  return `${API}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(`${WEB}/email-verified`)}`;
}

test('unverified users see a banner, can request a new link, and verifying returns to the app', async ({ page }) => {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `verify.${id}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: {
      name: 'Verify Me',
      username: `verify.${id}`,
      email,
      password: 'correct-horse-battery',
      primaryUse: 'FAN',
      callbackURL: `${WEB}/email-verified`,
    },
  });
  expect(res.status()).toBe(200);
  await page.request.post('/api/v1/me/onboarding/complete');

  // Optional verification: full access, plus an informative banner.
  await page.goto('/home');
  const banner = page.getByRole('status').filter({ hasText: 'Confirm your email.' });
  await expect(banner).toBeVisible();
  await expect(page.getByLabel('Share something with the community')).toBeVisible();

  await banner.getByRole('button', { name: 'Resend link' }).click();
  await expect(page.getByText(/We've asked for a new confirmation link/)).toBeVisible();
  await expect(banner.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();

  // Clicking the emailed link lands back in the web app, not on raw JSON.
  await page.goto(await verificationLink(email));
  await expect(page).toHaveURL(`${WEB}/email-verified`);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  await page.goto('/home');
  await expect(page.getByText('Confirm your email.')).toHaveCount(0);
});

test('an expired or invalid link explains what happened', async ({ page }) => {
  await page.goto(await verificationLink('nobody@example.test', -60));
  await expect(page).toHaveURL(/\/email-verified\?error=/);
  await expect(page.getByRole('heading', { name: "This link didn't work" })).toBeVisible();
});
