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
async function signUp(request: APIRequestContext, name: string, primaryUse = 'CREATOR') {
  const username = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${uid()}`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name, username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse },
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

test('opportunity: organiser drafts and publishes, a member applies, the organiser accepts', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const title = `Harbour DJ set ${uid()}`;

  // Organiser: approved by an admin (D7). The admin grant itself is covered by API tests.
  const org = await signUp(page.request, 'Event Organiser', 'PROFESSIONAL');
  await sql(`UPDATE "user" SET "emailVerified" = true, "isOrganiser" = true WHERE username = $1`, [org.username]);
  await page.goto('/opportunities');
  await page.getByRole('link', { name: 'Post an opportunity' }).click();
  // Wait for the editor: the listing page also has a "Type" filter group until the route changes.
  await expect(page.getByRole('heading', { name: 'Post an opportunity', level: 1 })).toBeVisible();
  await page.getByLabel('Type').selectOption('GIG');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Two-hour open-air set on Saturday evening; sound system provided.');
  await page.getByLabel('Location (optional)').fill('Douala');
  const deadline = new Date(Date.now() + 7 * 86_400_000);
  const local = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Application deadline').fill(local);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft — only you can see this')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Applicants (0)' })).toBeVisible();
  const url = page.url();

  // Member: finds it in the list, applies.
  const memberCtx = await browser.newContext({ ...info.project.use });
  const member = await memberCtx.newPage();
  await signUp(member.request, 'Keen Applicant');
  await member.goto(`${WEB}/opportunities?type=GIG`);
  await member.getByRole('link', { name: title }).click();
  await expect(member).toHaveURL(url);
  await member.getByLabel('Message to the organiser').fill('I play open-air sets most weekends — mixes on my profile.');
  await member.getByRole('button', { name: 'Apply' }).click();
  await expect(member.getByText('Application sent')).toBeVisible();
  await expect(member.getByText('Status: Submitted')).toBeVisible();
  await axeClean(member, 'opportunity detail (applicant)');

  // A member without organiser access can't post: honest explanation, no form.
  await member.goto(`${WEB}/opportunities/new`);
  await expect(member.getByRole('heading', { name: 'Organiser access needed' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Save draft' })).toHaveCount(0);

  // Organiser decides.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Applicants (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Shortlist' }).click();
  await expect(page.getByText('Keen Applicant: shortlisted')).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Keen Applicant: accepted')).toBeVisible();
  await axeClean(page, 'opportunity detail (organiser)');

  await member.goto(url);
  await expect(member.getByText('Status: Accepted')).toBeVisible();

  // Browse page: accessible and no horizontal scroll on a phone.
  await member.setViewportSize({ width: 360, height: 800 });
  await member.goto(`${WEB}/opportunities`);
  await expect(member.getByRole('link', { name: title })).toBeVisible();
  expect(await member.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await axeClean(member, 'opportunities list');
  await memberCtx.close();
});
