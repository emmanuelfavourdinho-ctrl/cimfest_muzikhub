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

test('collaboration: request from a profile, clarify in the open, accept, and run the project', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const tunde = await signUp(page.request, 'Tunde Beats');
  const ctx = await browser.newContext({ ...info.project.use });
  const zara = await ctx.newPage();
  const z = await signUp(zara.request, 'Zara Vocals');
  const title = `Night drive ${uid()}`;

  // Tunde finds Zara's profile and proposes a collaboration.
  await page.goto(`/u/${z.username}`);
  await page.locator('main').getByRole('link', { name: 'Collaborate' }).click();
  await page.getByLabel('Kind of collaboration').selectOption('FEATURE');
  await page.getByLabel('Project title').fill(title);
  await page.getByLabel('What would you like them to do?').fill('Hook vocals');
  await page.getByLabel('About the project').fill('A mid-tempo afro-soul record; the beat and first verse are done, I need a hook.');
  await page.getByLabel('Reference link 1').fill('https://soundcloud.com/tunde/night-drive-demo');
  await axeClean(page, 'collaboration request form');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Waiting for a reply')).toBeVisible();

  // Zara is notified and opens the request from the notification.
  await zara.goto('/notifications');
  await zara.getByText('Tunde Beats wants to collaborate').waitFor();
  await zara.getByRole('link', { name: 'Open' }).first().click();
  await expect(zara.getByRole('heading', { name: title })).toBeVisible();
  await zara.getByRole('button', { name: 'Ask a question' }).click();
  await zara.getByLabel('Your question').fill('What key is it in, and when are you recording?');
  await zara.getByRole('button', { name: 'Send question' }).click();
  await expect(zara.getByText('Question asked')).toBeVisible();

  // Tunde answers.
  await page.reload();
  await page.getByRole('button', { name: 'Answer the question' }).click();
  await page.getByLabel('Your answer').fill('F minor — recording Saturday at noon.');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByText('F minor — recording Saturday at noon.')).toBeVisible();

  // Zara accepts; a collaboration record exists for both.
  await zara.reload();
  await zara.getByRole('button', { name: 'Accept' }).click();
  await zara.getByRole('dialog').getByRole('button', { name: 'Accept and start' }).click();
  await zara.getByRole('link', { name: 'Open the collaboration' }).click();
  await expect(zara.getByRole('heading', { name: title })).toBeVisible();
  await expect(zara.getByText('In progress').first()).toBeVisible();
  await noOverflow(zara);
  await axeClean(zara, 'collaboration page');

  // Tunde sees it as a project, updates the status; Zara is told.
  await page.goto('/collaborate');
  await page.getByRole('link', { name: title }).click();
  await page.getByLabel('Add a progress note').fill('Stems sent by email.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Stems sent by email.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();

  // The conversation carries the request history as cards.
  await zara.goto('/messages');
  await zara.getByRole('link', { name: /Tunde Beats/ }).click();
  await expect(zara.getByRole('region', { name: 'Conversation' }).getByText(/accepted “Night drive/)).toBeVisible();
  await zara.goto('/notifications');
  await expect(zara.getByText(/is now completed/)).toBeVisible();
  await ctx.close();
  void tunde;
});
