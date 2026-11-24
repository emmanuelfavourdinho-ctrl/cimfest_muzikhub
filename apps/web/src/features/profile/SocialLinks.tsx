import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { Globe, Link2 } from 'lucide-react';
import {
  siApplemusic,
  siAudiomack,
  siBandcamp,
  siDeezer,
  siFacebook,
  siInstagram,
  siSoundcloud,
  siSpotify,
  siTiktok,
  siX,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import { LINK_PLATFORMS, type LinkPlatform, type ProfileLink } from '@muzikhub/shared';

/**
 * Official brand marks (Simple Icons, CC0). Boomplay and LinkedIn are not available
 * there, so they intentionally fall back to a generic link icon (CLAUDE.md §6.2:
 * never invent a logo).
 */
const brandIcons: Partial<Record<LinkPlatform, SimpleIcon>> = {
  SPOTIFY: siSpotify,
  APPLE_MUSIC: siApplemusic,
  YOUTUBE: siYoutube,
  SOUNDCLOUD: siSoundcloud,
  AUDIOMACK: siAudiomack,
  DEEZER: siDeezer,
  BANDCAMP: siBandcamp,
  INSTAGRAM: siInstagram,
  TIKTOK: siTiktok,
  FACEBOOK: siFacebook,
  X: siX,
};

export function PlatformIcon({ platform, className }: { platform: LinkPlatform; className?: string }) {
  const icon = brandIcons[platform];
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4.5 fill-current', className)}>
        <path d={icon.path} />
      </svg>
    );
  }
  const Fallback = platform === 'WEBSITE' ? Globe : Link2;
  return <Fallback aria-hidden className={cn('size-4.5', className)} />;
}

/** `trackClicks`: count clicks for the owner's analytics (public profile only, not previews). */
export function SocialLinks({ links, className, trackClicks }: { links: ProfileLink[]; className?: string; trackClicks?: boolean }) {
  if (links.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label="External profiles">
      {links.map((link) => {
        const label = LINK_PLATFORMS[link.platform].label;
        const host = new URL(link.url).hostname.replace(/^www\./, '');
        return (
          <li key={link.id}>
            <a
              href={link.url}
              onClick={trackClicks ? () => track('LINK_CLICK', { subjectType: 'PROFILE_LINK', subjectId: link.id }) : undefined}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={link.platform === 'WEBSITE' ? host : label}
              aria-label={`${link.platform === 'WEBSITE' ? host : label} (opens in a new tab)`}
              className="flex size-11 items-center justify-center rounded-full border border-control-border bg-surface-overlay text-text-1 transition hover:border-signal hover:text-signal focus-visible:border-signal"
            >
              <PlatformIcon platform={link.platform} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
