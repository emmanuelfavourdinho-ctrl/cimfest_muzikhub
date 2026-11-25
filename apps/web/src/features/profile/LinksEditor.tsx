import { useState } from 'react';
import { Link } from 'react-router';
import { useEntitlements } from '@/lib/billing';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { detectLinkPlatform, LINK_PLATFORMS, MAX_PROFILE_LINKS, normaliseHttpsUrl, type ProfileLink } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/form';
import { errorMessage } from '@/lib/api';
import { useReplaceLinks } from '@/lib/queries';
import { PlatformIcon } from './SocialLinks';

/**
 * Edit the ordered list of external links. The detected platform icon is a live
 * preview only — the server re-derives the platform from the URL on save.
 */
export function LinksEditor({
  initial,
  onSaved,
  submitLabel = 'Save links',
}: {
  initial: ProfileLink[];
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [urls, setUrls] = useState<string[]>(initial.length > 0 ? initial.map((l) => l.url) : ['']);
  const [error, setError] = useState<string | null>(null);
  // The member's plan decides how many links they can keep (the server checks it too).
  const limit = useEntitlements().data?.limits.profileLinks ?? MAX_PROFILE_LINKS;
  const save = useReplaceLinks();

  const update = (index: number, value: string) => setUrls((list) => list.map((u, i) => (i === index ? value : u)));
  const remove = (index: number) => setUrls((list) => (list.length === 1 ? [''] : list.filter((_, i) => i !== index)));
  const move = (index: number, delta: number) =>
    setUrls((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const filled = urls.map((u) => u.trim()).filter(Boolean);
    const invalid = filled.find((u) => !normaliseHttpsUrl(u));
    if (invalid) {
      setError(`"${invalid}" isn't a valid https:// link.`);
      return;
    }
    try {
      await save.mutateAsync({ links: filled.map((url) => ({ url })) });
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={error} />
      <ol className="space-y-2.5">
        {urls.map((url, index) => {
          const normalised = normaliseHttpsUrl(url);
          const platform = normalised ? detectLinkPlatform(normalised) : null;
          return (
            <li key={index} className="flex items-center gap-2">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-control-border bg-surface-overlay text-text-1"
                title={platform ? LINK_PLATFORMS[platform].label : 'Paste a link'}
              >
                {platform ? <PlatformIcon platform={platform} /> : <Plus className="size-4 text-text-3" />}
              </span>
              <Input
                aria-label={`Link ${index + 1}`}
                value={url}
                onChange={(e) => update(index, e.target.value)}
                placeholder="https://open.spotify.com/artist/…"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
              <div className="hidden shrink-0 sm:flex">
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  aria-label="Move up"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  aria-label="Move down"
                  onClick={() => move(index, 1)}
                  disabled={index === urls.length - 1}
                >
                  <ArrowDown />
                </Button>
              </div>
              <Button type="button" variant="quiet" size="icon" aria-label={`Remove link ${index + 1}`} onClick={() => remove(index)}>
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setUrls((l) => [...l, ''])} disabled={urls.length >= limit}>
          <Plus /> Add link
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : submitLabel}
        </Button>
      </div>
      <p className="mt-3 text-xs text-text-3">
        Spotify, Apple Music, YouTube, SoundCloud, Audiomack, Boomplay, Deezer, Bandcamp, Instagram, TikTok, Facebook, X, LinkedIn or your
        own website. Your plan allows up to {limit}.
      </p>
      {urls.filter(Boolean).length > limit && (
        <p role="alert" className="mt-2 text-small text-warning">
          You have more links than your current plan shows ({limit}). Visitors see the first {limit}; remove some to save changes, or{' '}
          <Link to="/pricing" className="underline">
            see plans
          </Link>
          .
        </p>
      )}
    </form>
  );
}
