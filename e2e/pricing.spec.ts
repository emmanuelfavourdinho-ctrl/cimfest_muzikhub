import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

function totp(secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
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
  const email = `${username}@example.test`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name, username, email, password: 'correct-horse-battery', primaryUse: 'CREATOR' },
  });
  expect(res.status()).toBe(200);
  await request.post('/api/v1/me/onboarding/complete');
  return { username, email, password: 'correct-horse-battery' };
}
async function axeClean(page: Page, what: string, include?: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include); // a modal: the dimmed page behind it is checked separately
  const { violations } = await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    what,
  ).toEqual([]);
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `no horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test('pricing: Free with real limits, every paid product "Coming soon" with no price', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'MuzikHub is free to use' })).toBeVisible();
  await expect(page.getByText('Up to 10 links on your profile')).toBeVisible();
  for (const name of ['Creator Plus', 'MuzikHub Pro', 'Post Boost', 'Profile Spotlight']) {
    const card = page.getByRole('region', { name });
    await expect(card.getByText('Coming soon')).toBeVisible();
    await expect(card).not.toContainText('FCFA');
  }
  await noOverflow(page);
  await axeClean(page, 'pricing page');
});

test('admin: change a price with a reason; it is audited and still not shown publicly', async ({ page }) => {
  test.setTimeout(90_000);
  const admin = await signUp(page.request, 'Pat Pricing');
  await sql(`UPDATE "user" SET "platformRole" = 'ADMIN', "emailVerified" = true WHERE email = $1`, [admin.email]);
  // Enrol 2FA through Better Auth's own endpoints (the UI enrolment is covered by admin-console.spec).
  const enabled = await page.request.post('/api/auth/two-factor/enable', { headers: { Origin: WEB }, data: { password: admin.password } });
  expect(enabled.status()).toBe(200);
  const secret = new URL((await enabled.json()).totpURI).searchParams.get('secret')!;
  expect(
    (await page.request.post('/api/auth/two-factor/verify-totp', { headers: { Origin: WEB }, data: { code: totp(secret) } })).status(),
  ).toBe(200);

  const price = 2000 + Math.floor(Math.random() * 400) * 5;
  const shown = `${new Intl.NumberFormat('fr-CM').format(price)} FCFA`;
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no mid-transition colours during axe scans
  await page.goto('/admin/pricing');
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  await page.getByRole('button', { name: 'Change price of Post Boost, 7 days' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New price (FCFA)').fill(String(price));
  await dialog.getByLabel('Reason (recorded in the audit log)').fill('E2E price check');
  const save = dialog.getByRole('button', { name: 'Save new price' });
  await expect(save).toBeEnabled();
  // The disabled → enabled opacity fade (150 ms) must finish before measuring contrast.
  await expect.poll(() => save.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await axeClean(page, 'change price dialog', 'dialog[open]');
  await dialog.getByRole('button', { name: 'Save new price' }).click();
  await expect(page.getByText('Price updated')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Post Boost' }).filter({ hasText: '7 days' });
  await expect(row).toContainText(shown);
  await expect(row).toContainText('E2E price check');
  await expect(row).toContainText('Not sellable yet');
  await noOverflow(page);
  await axeClean(page, 'admin pricing');

  await page.goto('/admin/audit');
  await expect(page.getByText('Changed price').first()).toBeVisible();

  // Public page: still no price, because Post Boost isn't sellable yet.
  await page.goto('/pricing');
  await expect(page.getByRole('region', { name: 'Post Boost' })).not.toContainText(shown);
});
