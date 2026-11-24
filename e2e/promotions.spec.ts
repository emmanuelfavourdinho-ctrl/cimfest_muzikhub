import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function sql(text: string, values: unknown[]) {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}
async function signUp(request: APIRequestContext, name: string) {
  const username = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${uid()}`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name, username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse: 'CREATOR' },
  });
  expect(res.status()).toBe(200);
  await request.post('/api/v1/me/onboarding/complete');
  return { username, name };
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
/** The provider's part (its hosted page exists only in development builds). */
async function payAtProvider(page: Page) {
  await page.waitForURL(/\/dev\/payments\/checkout\?reference=/);
  const reference = new URL(page.url()).searchParams.get('reference')!;
  expect(
    (
      await page.request.post(`/api/v1/dev/payments/orders/${reference}/settle`, { headers: { Origin: WEB }, data: { outcome: 'paid' } })
    ).status(),
  ).toBe(200);
  await page.goto(`/checkout/return?reference=${reference}`);
  await expect(page.getByRole('region', { name: 'Order status' })).toContainText('Paid', { timeout: 20_000 });
}

// Serial: both tests touch the one global Promoted slot.
test.describe.configure({ mode: 'serial' });

test('Post Boost: from the post menu to a labelled Promoted place in the feed and Discover', async ({ page }) => {
  test.setTimeout(120_000);
  await sql(`UPDATE "promotion" SET "status" = 'CANCELLED', "endedAt" = now(), "endedReason" = 'e2e reset' WHERE "status" = 'ACTIVE'`, []);
  const me = await signUp(page.request, 'Boost Artist');
  const text = `Boosted single ${uid()}`;
  const post = await (await page.request.post('/api/v1/posts', { headers: { Origin: WEB }, data: { body: text } })).json();

  await page.goto(`/p/${post.id}`);
  await page.getByRole('link', { name: 'Boost post' }).click();
  await expect(page.getByRole('heading', { name: 'Post Boost' })).toBeVisible();
  await expect(page.getByText('Test payments.')).toBeVisible();
  await page.getByRole('button', { name: /7 days/ }).click();
  await expect(page.getByText(/^Runs /)).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'promote page');
  await page.getByRole('button', { name: /Continue to payment/ }).click();
  await payAtProvider(page);

  await page.goto('/home');
  const slot = page.getByRole('region', { name: 'Promoted', exact: true });
  await expect(slot.getByText('Promoted', { exact: true })).toBeVisible();
  await expect(slot).toContainText(text);
  await noOverflow(page);
  await axeClean(page, 'feed with promoted slot');

  await page.goto('/discover');
  await expect(page.getByRole('region', { name: 'Promoted', exact: true })).toContainText(text);

  await page.goto('/settings/billing');
  await expect(page.getByRole('heading', { name: 'Your promotions' })).toBeVisible();
  await expect(page.getByText('Running')).toBeVisible();

  // Moderated or removed content loses its place immediately (read-time visibility).
  await sql(`UPDATE "post" SET "removedAt" = now() WHERE "id" = $1`, [post.id]);
  await page.goto('/home');
  await expect(page.getByText(text)).toHaveCount(0);
  void me;
});

test('Profile Spotlight: from your profile to the labelled Spotlight row', async ({ page }) => {
  test.setTimeout(90_000);
  const me = await signUp(page.request, 'Spot Light');
  await page.goto(`/u/${me.username}`);
  await page.getByRole('link', { name: 'Spotlight my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile Spotlight' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to payment/ }).click();
  await payAtProvider(page);
  await page.goto('/discover');
  const row = page.getByRole('region', { name: 'Spotlight' });
  await expect(row.getByText('Paid placement')).toBeVisible();
  await expect(row.getByRole('link', { name: me.name })).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'discover with spotlight');
});
