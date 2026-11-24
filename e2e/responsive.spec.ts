import { expect, test } from '@playwright/test';

// CLAUDE.md §21.7 test targets. Run once (desktop project) since it sets its own viewports.
const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1280, 1920];
const PAGES = ['/', '/login', '/register', '/forgot-password', '/privacy', '/terms', '/u/definitely.not.a.user'];

test('public pages never scroll horizontally at supported widths', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'viewport sweep runs once');
  test.setTimeout(180_000); // 9 widths × 5 pages
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});
