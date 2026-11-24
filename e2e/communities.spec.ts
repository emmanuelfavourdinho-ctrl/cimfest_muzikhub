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

test('community: create, discover, join, discuss, reply, and follow the notification back', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const name = `Mixing Room ${uid()}`;
  const owner = await signUp(page.request, 'Room Owner');

  // Owner starts a community.
  await page.goto('/communities');
  await page.getByRole('link', { name: 'Start a community' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('What is it for?').fill('Engineers and artists trading mixing notes, reference tracks and honest feedback.');
  await page.getByLabel('Category').selectOption('ENGINEERING');
  await page.getByLabel('Community rules').fill('Be specific. Be kind. Share stems only with permission.');
  await axeClean(page, 'community editor');
  await page.getByRole('button', { name: 'Create community' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const url = page.url();

  // A member discovers it, reads the rules, joins and asks a question.
  const ctx = await browser.newContext({ ...info.project.use });
  const member = await ctx.newPage();
  await signUp(member.request, 'Curious Singer');
  await member.goto('/communities');
  await member.getByLabel('Search communities').fill(name);
  await member.getByRole('button', { name: 'Search' }).click();
  await member.getByRole('link', { name }).click();
  await member.getByRole('tab', { name: 'about' }).click();
  await expect(member.getByText('Share stems only with permission.')).toBeVisible();
  await expect(member.getByRole('link', { name: /Room Owner/ })).toBeVisible();
  await member.getByRole('button', { name: 'Join' }).click();
  await expect(member.getByRole('button', { name: 'Leave' })).toBeVisible();
  await member.getByRole('tab', { name: 'discussions' }).click();
  await member.getByRole('button', { name: 'Start a discussion' }).click();
  await member.getByLabel('Type').selectOption('QUESTION');
  await member.getByLabel('Title').fill('How loud should my vocal sit?');
  await member.getByLabel('Details').fill('My vocals keep getting buried under the 808. Any tips?');
  await member.getByRole('button', { name: 'Post', exact: true }).click();
  await member.getByRole('link', { name: 'How loud should my vocal sit?' }).click();
  await noOverflow(member);
  await axeClean(member, 'discussion page');

  // The owner replies.
  await page.goto(url);
  await page.getByRole('link', { name: 'How loud should my vocal sit?' }).click();
  await page.getByLabel('Add a reply').fill('Carve 2–4 kHz out of the 808 and ride the vocal fader.');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByText('Carve 2–4 kHz out of the 808')).toBeVisible();

  // The member is notified and the notification opens the discussion.
  await member.goto('/notifications');
  await member.getByText(/Room Owner replied in/).waitFor();
  await member.getByRole('link', { name: 'Open' }).first().click();
  await expect(member.getByRole('heading', { name: 'How loud should my vocal sit?' })).toBeVisible();
  await expect(member.getByText('Carve 2–4 kHz out of the 808')).toBeVisible();
  // The asker marks the answer.
  await member.getByRole('button', { name: 'Mark as answer' }).click();
  await expect(member.getByText('Accepted answer')).toBeVisible();

  await page.goto(url);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How loud should my vocal sit?' })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/community-${info.project.name}.png`, fullPage: true });
  await page.goto('/communities');
  await noOverflow(page);
  await axeClean(page, 'communities hub');
  await ctx.close();
  void owner;
});
