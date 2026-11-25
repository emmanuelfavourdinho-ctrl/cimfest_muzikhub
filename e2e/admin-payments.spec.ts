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

test('admin payments: a late sandbox payment is reviewed, approved after re-verification, then refunded', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  // A member's order that is paid only after our 3-hour expiry → NEEDS_REVIEW (never auto-fulfilled).
  const memberCtx = await browser.newContext({ ...info.project.use });
  const member = await memberCtx.newPage();
  await signUp(member.request, 'Late Payer');
  const start = await member.request.post('/api/v1/checkout', {
    headers: { Origin: WEB, 'Idempotency-Key': `e2e-late-${uid()}` },
    data: { product: 'CREATOR_PLUS', option: 'MONTHLY' },
  });
  expect(start.status()).toBe(201);
  const reference = (await start.json()).order.reference as string;
  await sql(
    `UPDATE "payment_order" SET "createdAt" = "createdAt" - interval '4 hours', "expiresAt" = "expiresAt" - interval '4 hours' WHERE "reference" = $1`,
    [reference],
  );
  expect(
    (
      await member.request.post(`/api/v1/dev/payments/orders/${reference}/settle`, { headers: { Origin: WEB }, data: { outcome: 'paid' } })
    ).status(),
  ).toBe(200);
  await expect
    .poll(async () => (await sql(`SELECT "status" FROM "payment_order" WHERE "reference" = $1`, [reference])).rows[0].status, {
      timeout: 20_000,
    })
    .toBe('NEEDS_REVIEW');

  // An admin with two-step verification (enrolled through Better Auth's own endpoints).
  const admin = await signUp(page.request, 'Fin Ops');
  await sql(`UPDATE "user" SET "platformRole" = 'ADMIN', "emailVerified" = true WHERE email = $1`, [admin.email]);
  const enabled = await page.request.post('/api/auth/two-factor/enable', { headers: { Origin: WEB }, data: { password: admin.password } });
  const secret = new URL((await enabled.json()).totpURI).searchParams.get('secret')!;
  expect(
    (await page.request.post('/api/auth/two-factor/verify-totp', { headers: { Origin: WEB }, data: { code: totp(secret) } })).status(),
  ).toBe(200);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.goto('/admin/payments');
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(page.getByText('Test payments, excluded')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: reference });
  await expect(row).toContainText('Sandbox');
  await expect(row).toContainText('paid late');
  await noOverflow(page);
  await axeClean(page, 'admin payments list');

  await row.getByRole('link').click();
  await expect(page.getByText('Sandbox: test payment')).toBeVisible();
  await axeClean(page, 'admin payment detail');
  await page.getByRole('button', { name: 'Approve late payment' }).click();
  await page.getByLabel('Reason (recorded in the audit log)').fill('Customer paid within the window');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve late payment' }).click();
  await expect(page.getByText('Done')).toBeVisible();
  await expect
    .poll(async () => (await sql(`SELECT "status" FROM "payment_order" WHERE "reference" = $1`, [reference])).rows[0].status, {
      timeout: 20_000,
    })
    .toBe('FULFILLED');
  expect((await (await member.request.get('/api/v1/billing/entitlements')).json()).plan).toBe('CREATOR_PLUS');

  await page.reload();
  await page.getByRole('button', { name: 'Refund' }).click();
  await page.getByLabel('Reason (recorded in the audit log)').fill('Goodwill refund for the delay');
  await page.getByRole('dialog').getByRole('button', { name: 'Refund' }).click();
  await expect(page.getByText('Refunded', { exact: true }).first()).toBeVisible();
  expect((await (await member.request.get('/api/v1/billing/entitlements')).json()).plan).toBe('FREE');

  await page.goto('/admin/audit');
  await expect(page.getByText('Approved late payment').first()).toBeVisible();
  await expect(page.getByText('Refunded payment').first()).toBeVisible();
  await memberCtx.close();
});
