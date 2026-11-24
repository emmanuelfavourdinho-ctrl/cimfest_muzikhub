import { expect, test, type Page } from '@playwright/test';
import photos from '../apps/web/src/features/home/hero-photos.json' with { type: 'json' };

const SLIDE_MS = 7000;
const slugs = photos.map((p) => p.slug);

/** Slugs of hero photos the browser actually requested. */
function trackHeroRequests(page: Page) {
  const requested = new Set<string>();
  page.on('request', (r) => {
    const hit = slugs.find((s) => r.url().includes(`/brand/landing/${s}`));
    if (hit) requested.add(hit);
  });
  return requested;
}

const active = (page: Page) => page.getByTestId('hero-backdrop').getAttribute('data-active');
/** Waits until every <img> of a slide (that the browser is meant to load) has loaded. */
async function slideLoaded(page: Page, slug: string) {
  await expect
    .poll(() => page.locator(`[data-slide="${slug}"] img`).evaluateAll((imgs) => imgs.some((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)), { timeout: 20_000 })
    .toBe(true);
}

test('hero: first photo first (high priority), one-ahead loading, all five crossfade, headline stays put', async ({ page }) => {
  const requested = trackHeroRequests(page);
  await page.clock.install();
  await page.goto('/');

  const first = page.locator('[data-slide="red-studio"] img').first();
  await expect(first).toHaveAttribute('fetchpriority', 'high');
  await expect(first).toHaveAttribute('loading', 'eager');
  await expect(first).toHaveAttribute('alt', ''); // decorative: no names, no captions
  await slideLoaded(page, 'red-studio');
  // Never the whole set up front: the first photo plus, at most, the next one.
  expect([...requested].every((s) => s === 'red-studio' || s === 'coral-portrait')).toBe(true);
  // Other photos are explicitly low priority.
  await expect(page.locator('[data-slide] img[fetchpriority="high"]')).toHaveCount(1);

  const headline = page.getByRole('heading', { name: /Discover talent/ });
  const cta = page.getByRole('link', { name: 'Join MuzikHub' }).first();
  const before = { h: await headline.boundingBox(), c: await cta.boundingBox() };

  const seen = new Set([await active(page)]);
  for (let i = 1; i < slugs.length; i++) {
    await slideLoaded(page, slugs[i]!); // the next photo is fetched one slide ahead
    await page.clock.runFor(SLIDE_MS);
    await expect.poll(() => active(page)).toBe(slugs[i]);
    seen.add(await active(page));
    expect(requested.size, 'loads progressively, one ahead').toBeLessThanOrEqual(Math.min(i + 2, slugs.length));
  }
  expect([...seen].sort()).toEqual([...slugs].sort()); // all five approved photographs
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => active(page)).toBe('red-studio'); // loops

  expect(await headline.boundingBox()).toEqual(before.h);
  expect(await cta.boundingBox()).toEqual(before.c);
  await page.screenshot({ path: `e2e/.screenshots/landing-${test.info().project.name}.png` });
});

test('hero pauses while the tab is hidden', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await slideLoaded(page, 'red-studio');
  await slideLoaded(page, 'coral-portrait');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(SLIDE_MS * 4);
  expect(await active(page)).toBe('red-studio');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(SLIDE_MS);
  await expect.poll(() => active(page)).toBe('coral-portrait');
});

test('reduced motion: a single still photograph, no crossfade or zoom', async ({ browser }, info) => {
  const ctx = await browser.newContext({ ...info.project.use, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const requested = trackHeroRequests(page);
  await page.clock.install();
  await page.goto('/');
  await slideLoaded(page, 'red-studio');
  await page.clock.runFor(SLIDE_MS * 5);
  await expect(page.locator('[data-slide]')).toHaveCount(1);
  expect(await active(page)).toBe('red-studio');
  expect([...requested]).toEqual(['red-studio']);
  const animation = await page.locator('[data-slide="red-studio"] > div').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
  await ctx.close();
});

test('desktop: the 333×500 concert photo is never shown larger than its natural size', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop composition');
  await page.clock.install();
  await page.goto('/');
  for (const slug of slugs.slice(0, 3)) await slideLoaded(page, slug);
  await page.clock.runFor(SLIDE_MS * 2);
  await expect.poll(() => active(page)).toBe('stage-saxophone');
  const box = await page.locator('[data-slide="stage-saxophone"] .md\\:block img').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(333 + 1);
  expect(box!.height).toBeLessThanOrEqual(500 + 1);
});
