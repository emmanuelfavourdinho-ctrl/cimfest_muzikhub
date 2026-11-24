import { createHmac } from 'node:crypto';
import pg from 'pg';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** RFC 6238 TOTP — what an authenticator app would show. */
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
/** Waits for a fresh 30-second window so a code is never reused. */
async function nextWindow(page: Page) {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
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
  const res = await request.post('/api/auth/sign-up/email', { headers: { Origin: WEB }, data: { name, username, email, password: 'correct-horse-battery', primaryUse: 'CREATOR' } });
  expect(res.status()).toBe(200);
  await request.post('/api/v1/me/onboarding/complete');
  return { username, email, password: 'correct-horse-battery', name };
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `no horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test('admin: enrol in 2FA, sign in with a code, work a report end to end, restrict an account', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  // ── Set-up: an admin (as the CLI would grant), a member who posts, a member who reports ──
  const admin = await signUp(page.request, 'Ada Admin');
  await sql(`UPDATE "user" SET "platformRole" = 'ADMIN', "emailVerified" = true WHERE email = $1`, [admin.email]);

  const authorCtx = await browser.newContext({ ...info.project.use });
  const author = await authorCtx.newPage();
  const authorUser = await signUp(author.request, 'Spammy Poster');
  const text = `Cheap followers ${uid()}`;
  const post = await (await author.request.post('/api/v1/posts', { data: { body: text } })).json();
  const reporterCtx = await browser.newContext({ ...info.project.use });
  const reporter = await reporterCtx.newPage();
  await signUp(reporter.request, 'Careful Reporter');
  expect((await reporter.request.post('/api/v1/reports', { data: { targetType: 'POST', targetId: post.id, reason: 'SPAM', details: 'Selling followers' } })).status()).toBe(201);

  // ── 2FA enrolment is required before the console opens ──
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await page.getByLabel('Confirm your password').fill(admin.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByAltText(/QR code to add MuzikHub/)).toBeVisible();
  const secret = (await page.locator('code').first().textContent())!.trim();
  await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(10);
  await page.getByLabel("I've saved my backup codes somewhere safe").check();
  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText(/open report/)).toBeVisible();
  await noOverflow(page);

  // ── Sign out and back in: the second factor is now required ──
  await page.request.post('/api/auth/sign-out', { headers: { Origin: WEB }, data: {} });
  await nextWindow(page);
  await page.goto('/login?next=/admin/reports');
  await page.getByLabel('Email or username').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your authenticator code' })).toBeVisible();
  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);

  // ── Report lifecycle in the UI ──
  await page.getByRole('link', { name: 'Spam or scam' }).first().click();
  await expect(page.getByText(text)).toBeVisible();
  await page.getByRole('button', { name: 'Take this report' }).click();
  await expect(page.getByText('You are reviewing this report')).toBeVisible();
  await page.getByLabel('Add an internal note').fill('Account sells followers; matches known spam pattern.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Account sells followers; matches known spam pattern.')).toBeVisible();

  await page.getByRole('button', { name: 'Remove content' }).click();
  await page.getByLabel('Reason (recorded in the audit log)').fill('Spam: selling followers');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove content' }).click();
  await expect(page.getByText('Content removed')).toBeVisible();
  expect((await page.request.get(`/api/v1/posts/${post.id}`)).status()).toBe(404);

  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByLabel('Decision (what was done)').fill('Removed the spam post');
  await page.getByRole('dialog').getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Report resolved')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden(); // its textarea holds the same text while closing
  await expect(page.getByRole('paragraph').filter({ hasText: /^Removed the spam post$/ })).toBeVisible();
  await noOverflow(page);

  // ── Restrict the poster's account (reason required) ──
  await page.goto(`/admin/users?q=${authorUser.username}`);
  await page.getByRole('link', { name: /Spammy Poster/ }).click();
  await page.getByRole('button', { name: 'Restrict' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Restrict' });
  await expect(confirm).toBeDisabled(); // no reason yet
  await page.getByLabel('Reason (recorded in the audit log)').fill('Repeated spam posts');
  await confirm.click();
  await expect(page.getByText('Account restricted')).toBeVisible();
  await expect(page.getByText(/Restricted: Repeated spam posts|Repeated spam posts/).first()).toBeVisible();
  await noOverflow(page);

  // The member sees what happened; the server refuses posting.
  await author.goto(`${WEB}/home`);
  await expect(author.getByText('Your account is restricted.')).toBeVisible();
  await expect(author.getByText('Repeated spam posts')).toBeVisible();
  await expect(author.getByLabel('Share something with the community')).toHaveCount(0);
  expect((await author.request.post('/api/v1/posts', { data: { body: 'again' } })).status()).toBe(403);

  // ── Audit log shows each action ──
  await page.goto('/admin/audit');
  for (const label of ['Restricted account', 'Resolved report', 'Removed content', 'Added note', 'Took report']) {
    await expect(page.getByRole('cell', { name: label }).first()).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({ path: `e2e/.screenshots/admin-audit-${info.project.name}.png`, fullPage: true });

  await authorCtx.close();
  await reporterCtx.close();
});

test('members without a staff role are told they have no access', async ({ page }) => {
  await signUp(page.request, 'Just Member');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/overview')).status()).toBe(403);
});

test('admin pages fit narrow screens', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  test.setTimeout(120_000);
  const admin = await signUp(page.request, 'Narrow Admin');
  await sql(`UPDATE "user" SET "platformRole" = 'ADMIN', "emailVerified" = true WHERE email = $1`, [admin.email]);
  const enabled = await (await page.request.post('/api/auth/two-factor/enable', { headers: { Origin: WEB }, data: { password: admin.password } })).json();
  const secret = new URL(enabled.totpURI).searchParams.get('secret')!;
  expect((await page.request.post('/api/auth/two-factor/verify-totp', { headers: { Origin: WEB }, data: { code: totp(secret) } })).status()).toBe(200);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/admin', '/admin/reports', '/admin/users', '/admin/content', '/admin/audit']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await noOverflow(page);
    }
  }
});
