/**
 * External profile links (CLAUDE.md §6.2).
 * The platform is always DERIVED from the URL's hostname — never trusted from the client —
 * so a link labelled "Spotify" can only point at Spotify.
 */

export const LINK_PLATFORMS = {
  SPOTIFY: { label: 'Spotify', hosts: ['open.spotify.com', 'spotify.com', 'spotify.link'] },
  APPLE_MUSIC: { label: 'Apple Music', hosts: ['music.apple.com'] },
  YOUTUBE: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'music.youtube.com'] },
  SOUNDCLOUD: { label: 'SoundCloud', hosts: ['soundcloud.com', 'on.soundcloud.com'] },
  AUDIOMACK: { label: 'Audiomack', hosts: ['audiomack.com'] },
  BOOMPLAY: { label: 'Boomplay', hosts: ['boomplay.com', 'boomplaymusic.com'] },
  DEEZER: { label: 'Deezer', hosts: ['deezer.com', 'deezer.page.link'] },
  BANDCAMP: { label: 'Bandcamp', hosts: ['bandcamp.com'] },
  INSTAGRAM: { label: 'Instagram', hosts: ['instagram.com'] },
  TIKTOK: { label: 'TikTok', hosts: ['tiktok.com'] },
  FACEBOOK: { label: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
  X: { label: 'X', hosts: ['x.com', 'twitter.com'] },
  LINKEDIN: { label: 'LinkedIn', hosts: ['linkedin.com'] },
  WEBSITE: { label: 'Website', hosts: [] },
} as const satisfies Record<string, { label: string; hosts: readonly string[] }>;

export type LinkPlatform = keyof typeof LINK_PLATFORMS;
export const LINK_PLATFORM_KEYS = Object.keys(LINK_PLATFORMS) as [LinkPlatform, ...LinkPlatform[]];

export const MAX_PROFILE_LINKS = 10;

/** Returns a normalised https URL, or null when the value is not a safe https URL. */
export function normaliseHttpsUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // Only https: blocks javascript:, data:, file:, plain http and every other scheme.
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null; // https://spotify.com@evil.example tricks
  if (!url.hostname.includes('.')) return null;
  url.hash = '';
  return url.toString();
}

/** Detects the platform from the hostname (exact host or a subdomain of it). */
export function detectLinkPlatform(httpsUrl: string): LinkPlatform {
  const host = new URL(httpsUrl).hostname.toLowerCase().replace(/^www\./, '');
  for (const key of LINK_PLATFORM_KEYS) {
    const hosts: readonly string[] = LINK_PLATFORMS[key].hosts;
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return key;
  }
  return 'WEBSITE';
}
