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

test('messaging: start from a profile, live delivery, read receipt, survives refresh and offline, blocking', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const amara = await signUp(page.request, 'Amara Keys');
  const ctx = await browser.newContext({ ...info.project.use });
  const bayo = await ctx.newPage();
  const b = await signUp(bayo.request, 'Bayo Drums');
  // Connected, so the anti-spam cap doesn't apply in this journey.
  const req = await page.request.post('/api/v1/connections', { headers: { Origin: WEB }, data: { username: b.username } });
  await bayo.request.post(`/api/v1/connections/${(await req.json()).id}/accept`, { headers: { Origin: WEB } });

  // Amara opens Bayo's profile and starts a conversation.
  await page.goto(`/u/${b.username}`);
  await page.getByRole('button', { name: 'Message' }).click();
  await page.waitForURL(/\/messages\//);
  const thread = page.url();

  // Bayo is on his inbox; the message arrives live.
  await bayo.goto('/messages');
  await page.getByLabel('Message Bayo Drums').fill('Session on Friday at 6?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(bayo.getByRole('link', { name: /Amara Keys/ })).toContainText('Session on Friday at 6?', { timeout: 10_000 });
  await bayo.getByRole('link', { name: /Amara Keys/ }).click();
  await expect(bayo.getByRole('region', { name: 'Conversation' }).getByText('Session on Friday at 6?')).toBeVisible();
  // Amara sees it was read.
  await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Persists after a refresh.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Session on Friday at 6?')).toBeVisible();
  await noOverflow(page);
  await axeClean(page, 'conversation');

  // Bayo drops offline; Amara keeps writing; Bayo catches up when back.
  await ctx.setOffline(true);
  await page.getByLabel('Message Bayo Drums').fill('Bring the cajón please');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Bring the cajón please')).toBeVisible();
  await ctx.setOffline(false);
  await expect(bayo.getByRole('region', { name: 'Conversation' }).getByText('Bring the cajón please')).toBeVisible({ timeout: 20_000 });

  // Bayo's own draft survives a reload.
  await bayo.getByLabel('Message Amara Keys').fill('Will do — see you');
  await bayo.reload();
  await expect(bayo.getByLabel('Message Amara Keys')).toHaveValue('Will do — see you');

  // Blocking ends the conversation for both.
  await bayo.request.post('/api/v1/blocks', { headers: { Origin: WEB }, data: { username: amara.username } });
  await page.goto(thread);
  await expect(page.getByText('You can’t message each other.')).toBeVisible();
  await ctx.close();
});
