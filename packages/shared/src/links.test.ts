import { describe, expect, it } from 'vitest';
import { detectLinkPlatform, normaliseHttpsUrl } from './links.js';
import { replaceLinksSchema, usernameSchema } from './profile.js';

describe('normaliseHttpsUrl', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://open.spotify.com/artist/1',
    'https://open.spotify.com@evil.example/x',
    'not a url',
    'https://localhost/x',
  ])('rejects unsafe or invalid %s', (input) => {
    expect(normaliseHttpsUrl(input)).toBeNull();
  });

  it('accepts https and strips the fragment', () => {
    expect(normaliseHttpsUrl('  https://open.spotify.com/artist/1#top ')).toBe('https://open.spotify.com/artist/1');
  });
});

describe('detectLinkPlatform', () => {
  it.each([
    ['https://open.spotify.com/artist/1', 'SPOTIFY'],
    ['https://www.youtube.com/@someone', 'YOUTUBE'],
    ['https://youtu.be/abc', 'YOUTUBE'],
    ['https://m.facebook.com/page', 'FACEBOOK'],
    ['https://artist.bandcamp.com', 'BANDCAMP'],
    ['https://twitter.com/user', 'X'],
    ['https://myband.example.com', 'WEBSITE'],
    // Look-alike domains must not be treated as the real platform
    ['https://spotify.com.evil.example/x', 'WEBSITE'],
    ['https://notspotify.com/x', 'WEBSITE'],
  ])('%s → %s', (url, platform) => {
    expect(detectLinkPlatform(url)).toBe(platform);
  });
});

describe('replaceLinksSchema', () => {
  it('rejects duplicates after normalisation', () => {
    const result = replaceLinksSchema.safeParse({
      links: [{ url: 'https://x.com/a' }, { url: 'https://x.com/a#b' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('usernameSchema', () => {
  it('lowercases and accepts valid usernames', () => {
    expect(usernameSchema.parse('Ayo.Nova_1')).toBe('ayo.nova_1');
  });

  it.each(['ab', 'admin', '_start', 'end.', 'has space', 'émile'])('rejects %s', (v) => {
    expect(usernameSchema.safeParse(v).success).toBe(false);
  });
});
