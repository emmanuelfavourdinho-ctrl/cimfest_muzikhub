import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB = 'http://localhost:5273';
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Creates an account through the real auth API (cookie lands in this browser context). */
async function signUpViaApi(request: APIRequestContext, name: string, extra: Record<string, unknown> = {}) {
  const username = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${uid()}`;
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: { name, username, email: `${username}@example.test`, password: 'correct-horse-battery', primaryUse: 'CREATOR' },
  });
  expect(res.status()).toBe(200);
  await request.patch('/api/v1/me/profile', { data: extra });
  await request.post('/api/v1/me/onboarding/complete');
  return { username, name };
}

/** Real upload (API signature → Cloudinary → API verification), done outside the UI for seeding. */
async function seedUpload(request: APIRequestContext, file: string, mime: string, kind: string, purpose: string) {
  const bytes = readFileSync(fixture(file));
  const signed = await (await request.post('/api/v1/media/uploads', { data: { kind, purpose, bytes: bytes.length } })).json();
  const form = new FormData();
  for (const [k, v] of Object.entries(signed.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([bytes], { type: mime }), file);
  expect((await fetch(signed.uploadUrl, { method: 'POST', body: form })).status).toBe(200);
  expect((await request.post(`/api/v1/media/${signed.assetId}/confirm`)).status()).toBe(200);
  return signed.assetId as string;
}

async function noHorizontalOverflow(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
  expect(
    overflow,
    `no horizontal scroll on ${page.url()} at ${await page.evaluate(() => innerWidth)}px (widest: ${offenders.join(' | ')})`,
  ).toBeLessThanOrEqual(0);
}

test('creator uploads a profile photo and publishes a beat with real media; it reaches profile and feed', async ({ page }) => {
  const me = await signUpViaApi(page.request, 'Kora Beats', { roles: ['PRODUCER'], genres: ['amapiano'] });

  // Profile photo through the real uploader
  await page.goto('/settings/profile');
  await page.getByLabel('Upload a photo').setInputFiles(fixture('cover.png'));
  await expect(page.getByText('Profile photo updated')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText('Your profile photo')).toHaveAttribute('src', /res\.cloudinary\.com/);

  // Portfolio item: beat + cover, shared to the feed (checkbox ticked by default)
  await page.goto('/studio/new');
  await page.getByRole('button', { name: /Beat or instrumental/ }).click();
  await page.getByLabel('Title').fill('Midnight Makossa');
  await page.getByLabel('Choose an audio file').setInputFiles(fixture('beat.wav'));
  await expect(page.locator('audio')).toHaveCount(1, { timeout: 30_000 });
  await page.getByLabel('Choose a cover image').setInputFiles(fixture('cover.png'));
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 30_000 });
  await page.getByLabel('Description').fill('Afro-house instrumental, 122 BPM.');
  await page.getByRole('button', { name: 'Amapiano', exact: true }).click();
  await expect(page.getByLabel('Share to the feed when I publish')).toBeChecked();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  // Detail page: real CDN media, audio not preloaded
  await expect(page.getByRole('heading', { name: 'Midnight Makossa' })).toBeVisible();
  const audio = page.locator('audio');
  await expect(audio).toHaveAttribute('preload', 'none');
  await expect(audio).toHaveAttribute('src', /^https:\/\/res\.cloudinary\.com\/.+\/video\/upload\/.+\.mp3$/);

  // Public profile portfolio tab, as a signed-out visitor in a fresh context
  const visitor = await page.context().browser()!.newContext();
  const vpage = await visitor.newPage();
  await vpage.goto(`${WEB}/u/${me.username}`);
  await expect(vpage.getByRole('link', { name: /Midnight Makossa/ })).toBeVisible();
  await noHorizontalOverflow(vpage);
  await visitor.close();

  // Feed showcase post
  await page.goto('/home');
  await expect(page.locator('main').getByText('shared work').first()).toBeVisible();
  await expect(
    page
      .locator('main')
      .getByRole('link', { name: /Midnight Makossa/ })
      .first(),
  ).toBeVisible();
  await page.screenshot({ path: `e2e/.screenshots/feed-${test.info().project.name}.png`, fullPage: true });
});

test('a second person discovers, follows and connects; the creator accepts', async ({ page, browser }) => {
  const tag = uid().replace(/[0-9]/g, '').slice(0, 5) || 'zz';
  const creatorName = `Zuri Motion ${tag}`;
  const creator = await signUpViaApi(page.request, creatorName, {
    roles: ['DANCER'],
    genres: ['afro_house'],
    location: 'Yaoundé, Cameroon',
  });
  await page.request.post('/api/v1/posts', { data: { body: `Rehearsal notes ${uid()}` } });

  const fanCtx = await browser.newContext({ ...test.info().project.use });
  const fan = await fanCtx.newPage();
  await signUpViaApi(fan.request, 'Ayo Nova');

  // Discover by role + text — real search results
  await fan.goto(`${WEB}/discover`);
  await fan.getByRole('button', { name: 'Dancer', exact: true }).click();
  await fan.getByLabel('Search').fill(creatorName);
  await expect(fan.getByRole('link', { name: new RegExp(creatorName) })).toBeVisible();
  await noHorizontalOverflow(fan);
  await fan.getByRole('link', { name: new RegExp(creatorName) }).click();

  // Follow (instant) and Connect (needs acceptance) are separate
  await fan.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(fan.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(fan.getByText('1 followers')).toBeVisible();
  await fan.getByRole('button', { name: 'Connect', exact: true }).click();
  await fan.getByLabel('Add a note (optional)').fill('Love your choreography!');
  await fan.getByRole('button', { name: 'Send request' }).click();
  await expect(fan.getByRole('button', { name: /Requested/ })).toBeVisible();

  // Following feed now contains the creator's post
  await fan.goto(`${WEB}/home?tab=following`);
  await expect(fan.getByText(/Rehearsal notes/)).toBeVisible();

  // Creator accepts in Network → both sides connected
  await page.goto('/network');
  await expect(page.getByText('“Love your choreography!”')).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(/Connected with Ayo Nova/)).toBeVisible();
  await page.goto(`/u/${creator.username}`);
  await expect(page.getByText('1 connections')).toBeVisible();

  await fan.reload();
  await fan.goto(`${WEB}/u/${creator.username}`);
  await expect(fan.getByRole('button', { name: 'Connected' })).toBeVisible();
  await fanCtx.close();
});

test('post with an image, then like and comment as another person', async ({ page, browser }) => {
  await signUpViaApi(page.request, 'Naya Sol');
  const text = `Studio session ${uid()}`;
  await page.goto('/home');
  await page.getByLabel('Share something with the community').fill(text);
  await page.getByRole('button', { name: 'Images' }).click();
  // Hold the upload for a moment so the in-progress state is observable.
  await page.route('https://api.cloudinary.com/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByLabel(/Add an image/).setInputFiles(fixture('cover.png'));
  // While uploading, Post is disabled (it used to allow posting without the image).
  await expect(page.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const post = page.locator('section', { hasText: text }).first();
  await expect(post).toBeVisible();
  await expect(post.locator('img[src*="res.cloudinary.com"]')).toHaveAttribute('loading', 'lazy');

  const otherCtx = await browser.newContext({ ...test.info().project.use });
  const other = await otherCtx.newPage();
  await signUpViaApi(other.request, 'Rico Rhythm');
  await other.goto(`${WEB}/home`);
  const card = other.locator('section', { hasText: text }).first();
  await card.getByRole('button', { name: 'Like' }).click();
  await expect(card.getByRole('button', { name: 'Unlike' })).toContainText('1');
  await card.getByRole('button', { name: 'Comment' }).click();
  await card.getByLabel('Write a comment').fill('This mix is fire');
  await card.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(card.getByText('This mix is fire')).toBeVisible();

  // The author sees the real counts after reload (persisted, not local state)
  await page.reload();
  const mine = page.locator('section', { hasText: text }).first();
  await expect(mine.getByRole('button', { name: 'Like' })).toContainText('1');
  await expect(mine.getByRole('button', { name: '1', exact: true })).toBeVisible(); // comment count
  await otherCtx.close();
});

test('performance: images below the fold are not downloaded until scrolled to', async ({ page }, info) => {
  test.setTimeout(150_000);
  test.skip(info.project.name !== 'mobile', 'checked on the phone viewport');
  await signUpViaApi(page.request, 'Lazy Loader');
  // 8 image posts, each with its own real uploaded image
  const ids: string[] = [];
  // 14 posts ≈ 5,700px of feed: well beyond Chrome's built-in lazy-load look-ahead (~2,800px).
  for (let i = 0; i < 14; i++) {
    const id = await seedUpload(page.request, 'cover.png', 'image/png', 'IMAGE', 'POST');
    ids.push(id);
    await page.request.post('/api/v1/posts', { data: { body: `lazy ${i}`, mediaIds: [id] } });
  }
  // Count which of THIS test's 8 images were fetched (public_id ends with the asset id).
  const requested = new Set<string>();
  page.on('request', (r) => {
    const hit = ids.find((id) => r.url().includes(id));
    if (hit && r.resourceType() === 'image') {
      requested.add(hit);
      urls.push(r.url());
    }
  });
  const urls: string[] = [];
  await page.goto('/home');
  await expect(page.getByText('lazy 13')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const initial = requested.size;
  expect(initial, 'some feed images load initially').toBeGreaterThan(0);
  expect(initial, 'but not all 14 at once').toBeLessThan(14);

  // "lazy 2" is the last post on page 1 (12 per page): scrolling to it loads more images…
  await page.getByText('lazy 2').scrollIntoViewIfNeeded();
  // Lazy images are requested asynchronously after the scroll — poll rather than check once.
  await expect.poll(() => requested.size, { timeout: 10_000 }).toBeGreaterThan(initial);
  // …and reaching the end of the list fetches page 2 automatically (progressive loading).
  await page.mouse.wheel(0, 20_000);
  await expect(page.getByText('lazy 0')).toBeVisible({ timeout: 15_000 });
  expect(
    urls.filter((u) => /w_1280/.test(u)),
    'no full-size variants on a phone',
  ).toEqual([]);
});

test('slow 3G: the feed stays usable and an upload shows progress and completes', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'throttled on the phone viewport');
  await signUpViaApi(page.request, 'Slow Network');
  const cdp = await page.context().newCDPSession(page);
  // Chrome DevTools "Slow 3G"-like profile: ~400 kbps up/down, 400 ms latency.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 50_000,
    uploadThroughput: 50_000,
  });

  await page.goto('/home');
  await expect(page.getByLabel('Share something with the community')).toBeVisible({ timeout: 45_000 });

  await page.getByRole('button', { name: 'Audio' }).click();
  await page.getByLabel('Choose an audio file').setInputFiles(fixture('beat.wav')); // 132 KB ≈ 3 s at this speed
  const bar = page.getByRole('progressbar', { name: /Uploading beat.wav/ });
  await expect(bar).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1, { timeout: 60_000 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('upload failure shows a retry instead of hanging', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'once is enough');
  await signUpViaApi(page.request, 'Offline Uploader');
  await page.goto('/studio/new');
  await page.getByRole('button', { name: /Artwork or photo/ }).click();
  // Simulate Cloudinary being unreachable for this upload.
  await page.route('https://api.cloudinary.com/**', (route) => route.abort('internetdisconnected'));
  await page.getByLabel('Choose an image').setInputFiles(fixture('cover.png'));
  await expect(page.getByRole('alert')).toContainText(/Connection lost/, { timeout: 30_000 });
  await page.unroute('https://api.cloudinary.com/**');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible({ timeout: 30_000 });
});

test('new signed-in pages have no horizontal overflow at 320px', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'viewport sweep runs once');
  const me = await signUpViaApi(page.request, 'Narrow Screen', {
    roles: ['PRODUCER', 'MIXING_MASTERING_ENGINEER'],
    location: 'Bamenda, Cameroon',
  });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [
      '/home',
      '/discover',
      '/discover?view=work',
      '/studio',
      '/studio/new',
      '/network',
      `/u/${me.username}`,
      '/settings/profile',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await noHorizontalOverflow(page);
    }
  }
});
