import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';

const WEB = 'http://localhost:5273';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function signUp(request: APIRequestContext) {
  const username = `drawer.${uid()}`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name: 'Drawer Tester', username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse: 'CREATOR' },
  });
  expect(res.status()).toBe(200);
  await request.post('/api/v1/me/onboarding/complete');
  return username;
}

/** Every destination in the desktop sidebar (navigation.ts primaryNav). */
const DESTINATIONS = [
  ['Home', '/home'],
  ['Discover', '/discover'],
  ['Network', '/network'],
  ['Creator studio', '/studio'],
  ['Communities', '/communities'],
  ['Collaborate', '/collaborate'],
  ['Opportunities', '/opportunities'],
  ['Plans', '/pricing'],
  ['Competitions', '/competitions'],
  ['Messages', '/messages'],
] as const;

test.describe('mobile sidebar drawer', () => {
  test('opens from the top bar, lists the full sidebar navigation, and every link works', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'drawer exists below md only');
    test.setTimeout(120_000);
    const username = await signUp(page.request);
    await page.goto('/home');

    // The bottom bar is unchanged: same five items, same destinations.
    const bottom = page.getByRole('navigation', { name: 'Main', exact: true });
    await expect(bottom).toBeVisible();
    for (const [name, href] of [
      ['Home', '/home'],
      ['Discover', '/discover'],
      ['Create', '/studio/new'],
      ['Network', '/network'],
      ['Profile', `/u/${username}`],
    ]) {
      await expect(bottom.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await expect(bottom.getByRole('link')).toHaveCount(5);

    const trigger = page.getByRole('button', { name: 'Open menu' });
    for (const [name, path] of DESTINATIONS) {
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: 'Menu' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(drawer).toBeHidden(); // closes after navigation
    }

    // Active state follows the current route.
    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'Main menu' });
    await expect(menu.getByRole('link', { name: 'Messages', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Edit profile' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  });

  test('dismissal, focus return, scroll lock, internal scrolling and accessibility', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'drawer exists below md only');
    await page.setViewportSize({ width: 320, height: 480 }); // narrow and short: the list must scroll
    await signUp(page.request);
    await page.goto('/home');
    const trigger = page.getByRole('button', { name: 'Open menu' });
    const drawer = page.getByRole('dialog', { name: 'Menu' });

    // Escape closes and focus returns to the trigger.
    await trigger.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');

    // Tapping outside the panel closes it.
    await trigger.click();
    await page.mouse.click(310, 240);
    await expect(drawer).toBeHidden();

    // Close button; long list scrolls inside the drawer to the last item.
    await trigger.click();
    const scroller = drawer.locator('> div');
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const editProfile = drawer.getByRole('link', { name: 'Edit profile' });
    await editProfile.scrollIntoViewIfNeeded();
    await expect(editProfile).toBeInViewport();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(drawer).toBeHidden();
  });

  test('desktop keeps the sidebar and has no drawer trigger', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout');
    await signUp(page.request);
    await page.goto('/home');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
    const sidebar = page.getByRole('navigation', { name: 'Main', exact: true });
    for (const [name, path] of DESTINATIONS) await expect(sidebar.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
    await expect(page.getByRole('link', { name: 'Edit profile' })).toBeVisible();
  });
});
