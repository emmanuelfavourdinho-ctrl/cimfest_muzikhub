import { expect, test, type Page } from '@playwright/test';

/** Unique per run so tests never collide with earlier data. */
function newPerson() {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return {
    name: 'Kora Beats',
    username: `kora.${id}`,
    email: `kora-${id}@example.test`,
    password: 'correct-horse-battery',
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(0);
}

test('registration → onboarding → public profile → sign out → sign in', async ({ page }) => {
  const person = newPerson();

  // Landing → register
  await page.goto('/');
  await page.getByRole('link', { name: 'Join MuzikHub' }).first().click();

  // Step 1: how do you want to use MuzikHub?
  await expect(page.getByRole('heading', { name: 'How do you want to use MuzikHub?' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Artist or creator/ }).click();

  // Step 2: account details
  await page.getByLabel('Name', { exact: true }).fill(person.name);
  await page.getByLabel('Username').fill(person.username);
  await expect(page.getByText('✓ Available')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Onboarding step 1: roles (multiple)
  await expect(page.getByRole('heading', { name: 'What do you do in music?' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Producer', exact: true }).click();
  await page.getByRole('button', { name: 'Songwriter', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: genres + goals
  await expect(page.getByRole('heading', { name: 'Which genres are you into?' })).toBeVisible();
  await page.getByRole('button', { name: 'Afrobeats', exact: true }).click();
  await page.getByRole('button', { name: 'Amapiano', exact: true }).click();
  await page.getByRole('button', { name: 'Find collaborators' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: about
  await expect(page.getByRole('heading', { name: 'Introduce yourself' })).toBeVisible();
  await page.getByLabel('Short bio').fill('Producer crafting bold cross-border sounds.');
  await page.getByLabel('Location').fill('Buea, Cameroon');
  await page.getByLabel('Career stage').selectOption('DEVELOPING');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 4: links → finish
  await expect(page.getByRole('heading', { name: 'Where can people hear your work?' })).toBeVisible();
  await page.getByLabel('Link 1', { exact: true }).fill('https://open.spotify.com/artist/abc123');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Link 2', { exact: true }).fill('https://www.youtube.com/@korabeats');
  await page.getByRole('button', { name: 'Save & finish' }).click();

  // Public profile shows the persisted data
  await expect(page).toHaveURL(new RegExp(`/u/${person.username.replace('.', '\\.')}$`));
  await expect(page.getByRole('heading', { name: person.name })).toBeVisible();
  // Milestone 2: the profile opens on Portfolio; the bio lives in the About tab.
  await page.getByRole('tab', { name: 'about' }).click();
  await expect(page.getByText('Producer crafting bold cross-border sounds.')).toBeVisible();
  await expect(page.locator('main').getByText('Producer · Songwriter').first()).toBeVisible();
  const spotify = page.getByRole('link', { name: 'Spotify (opens in a new tab)' });
  await expect(spotify).toHaveAttribute('href', 'https://open.spotify.com/artist/abc123');
  await expect(spotify).toHaveAttribute('rel', /noopener/);
  await expect(page.getByRole('link', { name: 'YouTube (opens in a new tab)' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `e2e/.screenshots/profile-${test.info().project.name}.png`, fullPage: true });

  // Data survives a full reload (it came from the database, not page state)
  await page.reload();
  await expect(page.getByText('Buea, Cameroon').first()).toBeVisible();

  // Sign out → protected pages redirect to login
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.goto('/settings/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile/);

  // Sign in with the username → returned to the page originally requested
  await page.getByLabel('Email or username').fill(person.username);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('wrong password shows an error and stays signed out', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('nobody@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('unknown profile shows a not-found state', async ({ page }) => {
  await page.goto('/u/definitely.not.a.user');
  await expect(page.getByRole('heading', { name: /There's no one at/ })).toBeVisible();
});
