import { Link } from 'react-router';
import { Lock, MessageSquare, UserPlus, Users } from 'lucide-react';
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_POLICIES,
  COMMUNITY_ROLES,
  DISCUSSION_KINDS,
  type CommunityCard,
  type DiscussionView,
} from '@muzikhub/shared';
import { Avatar, Pill } from '@/components/ui/primitives';
import { timeAgo } from '@/features/feed/PostCard';
import { cn } from '@/lib/cn';

const nf = new Intl.NumberFormat();

export function PolicyBadge({ policy }: { policy: CommunityCard['policy'] }) {
  const Icon = policy === 'OPEN' ? Users : policy === 'REQUEST' ? UserPlus : Lock;
  return (
    <span className="inline-flex items-center gap-1 text-caption text-text-2" title={COMMUNITY_POLICIES[policy].help}>
      <Icon aria-hidden className="size-3.5" /> {COMMUNITY_POLICIES[policy].label}
    </span>
  );
}

export function RoleBadge({ role }: { role: keyof typeof COMMUNITY_ROLES | null }) {
  if (!role || role === 'MEMBER') return null;
  return <Pill variant={role === 'OWNER' ? 'signal' : 'violet'}>{COMMUNITY_ROLES[role]}</Pill>;
}

/** One community in a list: a row, not a card grid — name, purpose, real counts, recency. */
export function CommunityRow({ c }: { c: CommunityCard }) {
  return (
    <li className="flex gap-4 border-b border-hairline-strong py-4 last:border-b-0">
      <div aria-hidden className="size-14 shrink-0 overflow-hidden rounded-s bg-surface-overlay">
        {c.cover ? (
          <img src={c.cover} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <span className="flex size-full items-center justify-center text-h3 text-signal">{c.name.charAt(0)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-body font-semibold">
            <Link to={`/communities/${c.slug}`} className="hover:text-signal">
              {c.name}
            </Link>
          </h3>
          {c.membership?.status === 'ACTIVE' && <Pill>Joined</Pill>}
          {c.membership?.status === 'PENDING' && <Pill variant="gray">Requested</Pill>}
          {c.membership?.status === 'INVITED' && <Pill variant="gold">Invited</Pill>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-small text-text-2">{c.description}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-3">
          <span>{COMMUNITY_CATEGORIES[c.category]}</span>
          <PolicyBadge policy={c.policy} />
          <span>
            {nf.format(c.memberCount)} {c.memberCount === 1 ? 'member' : 'members'}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare aria-hidden className="size-3.5" /> {nf.format(c.discussionCount)}
          </span>
          {c.lastActivityAt && <span>Active {timeAgo(c.lastActivityAt)}</span>}
        </p>
      </div>
    </li>
  );
}

const KIND_TONE: Record<DiscussionView['kind'], 'signal' | 'gray' | 'gold' | 'violet'> = {
  DISCUSSION: 'gray',
  QUESTION: 'gold',
  GUIDE: 'signal',
  MENTORSHIP: 'violet',
  ANNOUNCEMENT: 'signal',
};
export const KindPill = ({ kind }: { kind: DiscussionView['kind'] }) => <Pill variant={KIND_TONE[kind]}>{DISCUSSION_KINDS[kind]}</Pill>;

export function DiscussionRow({ d, showCommunity }: { d: DiscussionView; showCommunity?: boolean }) {
  return (
    <li className={cn('flex gap-3 border-b border-hairline-strong py-3.5 last:border-b-0', d.pinned && 'bg-surface-raised')}>
      <Avatar name={d.author.name} image={d.author.image} className="mt-0.5 size-9 shrink-0 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindPill kind={d.kind} />
          {d.pinned && <span className="text-caption text-text-3">Pinned</span>}
          {d.locked && <span className="text-caption text-text-3">Locked</span>}
          {d.kind === 'QUESTION' && d.answered && <span className="text-caption text-success">Answered</span>}
        </div>
        <h3 className="mt-1 text-body font-semibold">
          <Link to={`/communities/${d.community.slug}/d/${d.id}`} className="hover:text-signal">
            {d.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-caption text-text-3">
          {d.author.name}
          {showCommunity && <> in {d.community.name}</>} · {timeAgo(d.lastActivityAt)} · {d.commentCount}{' '}
          {d.commentCount === 1 ? 'reply' : 'replies'}
          {d.helpfulCount > 0 && <> · {d.helpfulCount} found this helpful</>}
        </p>
      </div>
    </li>
  );
}
