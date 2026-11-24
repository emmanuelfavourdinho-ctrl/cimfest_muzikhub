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
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `no horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test('competition: organiser publishes, an entrant accepts the rules and enters, a judge scores, results are published', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const title = `Douala Beat Cup ${uid()}`;

  // Organiser (admin-approved, D7) drafts and publishes.
  const org = await signUp(page.request, 'Cup Organiser', 'PROFESSIONAL');
  await sql(`UPDATE "user" SET "emailVerified" = true, "isOrganiser" = true WHERE username = $1`, [org.username]);
  await page.goto('/competitions');
  await page.getByRole('link', { name: 'Run a competition' }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('Make an original makossa-inspired beat, at most three minutes long.');
  await page.getByLabel('Eligibility', { exact: true }).fill('Open to every MuzikHub member.');
  await page.getByLabel('Rules', { exact: true }).fill('One entry each. Original work only; no uncleared samples.');
  await page.getByLabel('Prize', { exact: true }).fill('A studio day offered by the organiser');
  await page.getByLabel('How judging works').fill('Judges score each entry on the criteria below.');
  await page.getByLabel('Disqualification', { exact: true }).fill('Plagiarised or uncleared work is removed.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('main').getByText('Open for entries', { exact: true }).first()).toBeVisible();
  const slug = new URL(page.url()).pathname.split('/').pop()!;

  // A judge is assigned by username.
  const judgeCtx = await browser.newContext({ ...info.project.use });
  const judge = await judgeCtx.newPage();
  const j = await signUp(judge.request, 'Fair Judge');
  await page.getByLabel('Add a judge by username').fill(`@${j.username}`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Fair Judge' })).toBeVisible();

  // Entrant reads the terms, must accept the rules, then enters with a link.
  const entrantCtx = await browser.newContext({ ...info.project.use });
  const entrant = await entrantCtx.newPage();
  await signUp(entrant.request, 'Eager Entrant');
  await entrant.goto(`${WEB}/competitions`);
  await entrant.getByRole('link', { name: title }).click();
  await expect(entrant.getByRole('heading', { name: /Rules/ })).toBeVisible();
  await expect(entrant.getByText('MuzikHub doesn’t provide or guarantee prizes.')).toBeVisible();
  await axeClean(entrant, 'competition detail (entrant)');
  await noOverflow(entrant);
  await entrant.getByRole('button', { name: 'Enter this competition' }).click();
  const dialog = entrant.getByRole('dialog');
  await dialog.getByLabel('Title of your entry').fill('Wouri Nights');
  await dialog.getByLabel(/Link to your work|or a link/).fill('https://soundcloud.com/example/wouri-nights');
  const submit = dialog.getByRole('button', { name: 'Submit entry' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await submit.click();
  await expect(entrant.getByText('Wouri Nights')).toBeVisible();
  await expect(entrant.getByText(/rules v1/)).toBeVisible();

  // Entries close (time travel in the test database only).
  await sql(`UPDATE "competition" SET "opensAt" = now() - interval '2 hours', "closesAt" = now() - interval '1 minute' WHERE slug = $1`, [
    slug,
  ]);

  // The judge scores every criterion.
  await judge.goto(`${WEB}/competitions/${slug}/judging`);
  const card = judge.getByRole('region', { name: 'Entry: Wouri Nights' });
  await card.getByLabel('Originality (50%)').fill('9');
  await card.getByLabel('Execution (50%)').fill('8');
  await card.getByLabel(/Feedback for the entrant/).fill('Lovely groove; the mix is a little crowded.');
  await card.getByRole('button', { name: 'Save score' }).click();
  await expect(judge.getByText('Score saved')).toBeVisible();
  await axeClean(judge, 'judging');
  await noOverflow(judge);

  // The organiser publishes results.
  await page.goto(`/competitions/${slug}/judging`);
  await expect(page.getByText('Fair Judge: 85')).toBeVisible();
  await page.getByRole('button', { name: 'Publish results' }).click();
  await expect(page.getByText('Results published')).toBeVisible();

  // The entrant is told, sees the result and the judge's feedback, and could dispute.
  await entrant.goto(`${WEB}/notifications`);
  await entrant
    .getByRole('listitem')
    .filter({ hasText: `You placed #1 in “${title}”` })
    .getByRole('link', { name: 'Open' })
    .click();
  await expect(entrant.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(entrant.getByText('“Lovely groove; the mix is a little crowded.”')).toBeVisible();
  await expect(entrant.getByRole('button', { name: 'Dispute the results' })).toBeVisible();
  await axeClean(entrant, 'competition results');

  await judgeCtx.close();
  await entrantCtx.close();
});

test('competition: members without organiser access see an honest explanation', async ({ page }) => {
  await signUp(page.request, 'Plain Member');
  await page.goto('/competitions');
  await expect(page.getByRole('heading', { name: 'Challenges with real stakes', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run a competition' })).toHaveCount(0);
  await axeClean(page, 'competitions list');
  await noOverflow(page);
});
