import { Link } from 'react-router';
import { Disc3, FileText, Image as ImageIcon, Lock, Music2, Star, Video } from 'lucide-react';
import { GENRES, LINK_PLATFORMS, PORTFOLIO_TYPES, type PortfolioItemView, type PortfolioType } from '@muzikhub/shared';
import { ResponsiveImage } from '@/components/media/Media';
import { Pill } from '@/components/ui/primitives';

export const typeIcons: Record<PortfolioType, typeof Music2> = {
  AUDIO: Music2,
  BEAT: Disc3,
  VIDEO: Video,
  IMAGE: ImageIcon,
  PROJECT: FileText,
};

/** Prototype `.work` card. The image is the cover, the image item itself, or a video poster. */
export function PortfolioCard({
  item,
  showOwner = false,
  showStatus = false,
}: {
  item: PortfolioItemView;
  showOwner?: boolean;
  showStatus?: boolean;
}) {
  const Icon = typeIcons[item.type];
  const visual = item.cover ?? (item.media?.kind === 'IMAGE' ? item.media : null);
  const poster = !visual && item.media?.kind === 'VIDEO' ? item.media.urls.poster : null;

  return (
    <Link
      to={`/work/${item.id}`}
      className="group block overflow-hidden rounded-[13px] border border-[#2d5441] bg-[#102920] transition hover:border-[#3a7f60]"
    >
      <div className="relative">
        {visual ? (
          <ResponsiveImage media={visual} alt="" aspect="4 / 3" sizes="(min-width: 1024px) 25vw, 50vw" />
        ) : poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-forest-800 object-cover" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center bg-[radial-gradient(ellipse_at_70%_20%,#1b6b4a_0%,transparent_60%),#0b241b] text-mint/80">
            <Icon className="size-9" aria-hidden />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          {item.featured && (
            <Pill variant="gold" className="px-2 py-0.5">
              <Star className="size-3" /> Featured
            </Pill>
          )}
          {item.visibility === 'PRIVATE' && (
            <Pill variant="gray" className="px-2 py-0.5">
              <Lock className="size-3" /> Private
            </Pill>
          )}
          {showStatus && item.status !== 'PUBLISHED' && (
            <Pill variant={item.status === 'DRAFT' ? 'violet' : 'gray'} className="px-2 py-0.5">
              {item.status === 'DRAFT' ? 'Draft' : 'Archived'}
            </Pill>
          )}
        </div>
      </div>
      <div className="p-3">
        <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-[#86caaa] uppercase">
          <Icon className="size-3" aria-hidden /> {PORTFOLIO_TYPES[item.type].label}
        </p>
        <strong className="mt-1 block truncate text-sm">{item.title}</strong>
        <span className="block truncate text-[11px] text-[#9ab9a6]">
          {showOwner ? `${item.owner.name} · ` : ''}
          {item.genres.map((g) => GENRES[g]).join(' · ') ||
            (item.externalPlatform ? `On ${LINK_PLATFORMS[item.externalPlatform].label}` : ' ')}
        </span>
      </div>
    </Link>
  );
}

export function PortfolioGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{children}</div>;
}
