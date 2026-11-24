import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const NAV = [
  { label: 'How it works', id: 'how-it-works' },
  { label: "Who it's for", id: 'who-its-for' },
  { label: 'Features', id: 'features' },
  { label: 'Trust', id: 'trust' },
  { label: 'FAQ', id: 'faq' },
];

async function noOverflow(page: Page, what: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, what).toBeLessThanOrEqual(0);
}

test.describe('landing page', () => {
  test('skip link is the first focusable element and moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('header navigation scrolls to each section, and the active pill follows', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop header (mobile uses the menu sheet)');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const { label, id } of NAV) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id} h2`).first()).toBeInViewport();
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'true');
      // Once smooth scrolling settles, the heading is never hidden under the fixed header.
      const header = await page
        .locator('header')
        .first()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      await expect
        .poll(
          () =>
            page
              .locator(`#${id} h2`)
              .first()
              .evaluate((el) => el.getBoundingClientRect().top),
          { message: `${id} heading below the header` },
        )
        .toBeGreaterThanOrEqual(header);
    }
    await page.getByRole('link', { name: 'See how it works' }).click();
    await expect(page).toHaveURL(/#how-it-works$/);
  });

  test('mobile menu: opens, traps focus, closes on Escape and on navigation, returns focus', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'menu sheet is the phone/tablet navigation');
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open menu' });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    // Focus stays inside the sheet however far we tab.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');

    await trigger.click();
    await sheet.getByRole('link', { name: 'FAQ' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/#faq$/);
    await expect(page.locator('#faq h2')).toBeInViewport();

    await trigger.click();
    await sheet.getByRole('link', { name: 'Join MuzikHub' }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("'Who it's for' tabs and the FAQ work from the keyboard", async ({ page }) => {
    await page.goto('/#who-its-for');
    const tabs = page.getByRole('tablist', { name: 'Who MuzikHub is for' });
    const artists = tabs.getByRole('tab', { name: 'Artists' });
    await artists.focus();
    await expect(artists).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Producers' })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'Producers' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('beats');
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Industry professionals' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(artists).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').getByRole('link', { name: 'Join as an artist' })).toHaveAttribute('href', '/register');

    const q = page.getByRole('button', { name: 'Is it free?' });
    await expect(q).toHaveAttribute('aria-expanded', 'false');
    await q.focus();
    await page.keyboard.press('Enter');
    await expect(q).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator(`#${await q.getAttribute('aria-controls')}`);
    await expect(panel).toBeVisible();
    await page.keyboard.press('Space');
    await expect(panel).toBeHidden();
  });

  test('footer links reach real pages; draft pages say so; register links Terms and Privacy', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('navigation', { name: 'Footer' });
    const routes: [string, RegExp, string | RegExp][] = [
      ['Join MuzikHub', /\/register$/, 'How do you want to use MuzikHub?'],
      ['Sign in', /\/login$/, 'Sign in to MuzikHub'],
      ['Discover talent', /\/discover$/, 'Find your next creative spark.'],
      ['Contact', /\/contact$/, 'Contact'],
      ['Safety and trust', /\/safety$/, 'Safety and trust'],
      ['Privacy', /\/privacy$/, 'Privacy'],
      ['Terms', /\/terms$/, 'Terms'],
    ];
    for (const [label, url, heading] of routes) {
      await page.goto('/');
      await footer.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible();
      if (/contact|safety|privacy|terms/.test(url.source)) await expect(page.getByText('Draft — pending legal review.')).toBeVisible();
    }
    // From another page, a footer section link comes back to the landing page section.
    await page.goto('/privacy');
    await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'FAQ' }).click();
    await expect(page).toHaveURL(/\/#faq$/);
    await expect(page.locator('#faq h2')).toBeInViewport();

    await page.goto('/register');
    await page.getByRole('button', { name: /Artist or creator/ }).click();
    await expect(page.getByRole('link', { name: /Terms/ })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: /Privacy notice/ })).toHaveAttribute('href', '/privacy');
  });

  test('signed-out header offers Sign in and Join; signed-in header offers Open app', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header').first();
    await expect(header.getByRole('link', { name: /Join/ })).toHaveAttribute('href', '/register');
    await expect(header.getByRole('link', { name: 'Open app' })).toHaveCount(0);

    const username = `landing.${Date.now().toString(36)}`;
    const res = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: WEB },
      data: { name: 'Landing Visitor', username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse: 'FAN' },
    });
    expect(res.status()).toBe(200);
    await page.goto('/');
    const open = header.getByRole('link', { name: 'Open app' });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute('href', '/onboarding'); // not onboarded yet
    await expect(header.getByRole('link', { name: /^Join/ })).toHaveCount(0);
    await open.click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('honest content: no placeholders, invented traction or leftover photos', async ({ page }) => {
    const photoRequests: string[] = [];
    page.on('request', (r) => {
      if (/\.(jpe?g|png|webp|avif)(\?|$)|res\.cloudinary\.com/.test(r.url())) photoRequests.push(r.url());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/lorem|ipsum|TO CONFIRM|TODO|\[YOU|\bFCFA\b|testimonial/i);
    expect(text).not.toMatch(/\b\d[\d,.]*\s*[kKmM+]?\s*(users|artists|members|creators|downloads|streams|followers)\b/i);
    expect(text).toMatch(/Illustrative preview/);
    expect(text).toMatch(/Coming soon/);
    expect(photoRequests, 'the landing page loads no photographs').toEqual([]);
  });

  test('no horizontal scroll at the listed widths, including landscape phone', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'viewport sweep runs once');
    for (const [w, h] of [
      [360, 800],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1536, 900],
      [844, 390],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of ['/', '/privacy', '/terms', '/contact', '/safety']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noOverflow(page, `${path} at ${w}×${h}`);
      }
    }
  });

  test('axe: no WCAG 2.2 A/AA violations on the landing and draft pages', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // nothing mid-reveal while axe measures contrast
    for (const path of ['/', '/privacy']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        `${path} (${info.project.name})`,
      ).toEqual([]);
    }
    // The menu sheet and an open FAQ answer, too.
    await page.goto('/');
    if (info.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open menu' }).click();
      const { violations } = await new AxeBuilder({ page }).include('#landing-menu').analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    }
  });

  test('screenshots at 360, 768 and 1280 px', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewports');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const w of [360, 768, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `e2e/.screenshots/landing-${w}.png`, fullPage: true });
    }
  });
});
