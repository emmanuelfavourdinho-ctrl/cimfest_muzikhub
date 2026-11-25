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
  return { username, id: (await res.json()).user.id as string };
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

test('analytics: real visits and clicks reach the owner’s dashboard; Free sees an honest upsell', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const owner = await signUp(page.request, 'Chart Owner');
  const work = await (
    await page.request.post('/api/v1/portfolio', {
      headers: { Origin: WEB },
      data: { type: 'VIDEO', title: `Live set ${uid()}`, externalUrl: 'https://youtu.be/abc123', publish: true },
    })
  ).json();

  // Free: no numbers, an honest explanation.
  await page.goto('/studio/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics are part of Creator Plus and MuzikHub Pro' })).toBeVisible();

  // A fan visits the profile and clicks the link on the work.
  const fanCtx = await browser.newContext({ ...info.project.use });
  const fan = await fanCtx.newPage();
  await signUp(fan.request, 'Curious Fan');
  await fan.goto(`/u/${owner.username}`);
  await expect(fan.getByRole('heading', { name: 'Chart Owner' })).toBeVisible();
  await fan.goto(`/work/${work.id}`);
  const beacon = fan.waitForRequest((r) => r.url().includes('/api/v1/analytics/events') && r.method() === 'POST');
  const popup = fan.waitForEvent('popup');
  await fan.getByRole('link', { name: /Open on YouTube/ }).click();
  await beacon;
  await (await popup).close();
  await fanCtx.close();

  // Pro (granted directly: the purchase itself is covered by subscriptions.spec).
  await sql(
    `INSERT INTO "subscription" ("id","userId","plan","periodStart","periodEnd","status","createdAt") VALUES ($1,$2,'PRO',now() - interval '1 day', now() + interval '29 days','ACTIVE',now())`,
    [`e2e-${uid()}`, owner.id],
  );
  await page.goto('/studio/analytics');
  const tile = (name: string) => page.locator('section', { hasText: name }).first();
  // The headline number is the second line of each tile.
  await expect(tile('Profile views').locator('p').nth(1)).toHaveText('1');
  await expect(tile('Link clicks').locator('p').nth(1)).toHaveText('1');
  await expect(tile('Plays').locator('p').nth(1)).toHaveText('0');
  await expect(page.getByRole('region', { name: 'Per-item analytics' })).toContainText(work.title);
  await noOverflow(page);
  await axeClean(page, 'analytics dashboard');
  await page.screenshot({ path: `e2e/.results/analytics-${info.project.name}.png`, fullPage: true });
});
