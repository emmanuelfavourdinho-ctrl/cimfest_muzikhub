import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Pill } from '@/components/ui/primitives';
import { PostCard } from '@/features/feed/PostCard';
import { billingApi } from '@/lib/billing';

/**
 * The paid places. Each is clearly labelled and sits OUTSIDE the organic list and its paging, so
 * promotion never replaces or reorders organic discovery. Nothing renders when nothing is running
 * (or if the request fails: organic content must never depend on it).
 */
export function PromotedPost() {
  const q = useQuery({ queryKey: ['promoted', 'posts'], queryFn: billingApi.promotedPosts, staleTime: 60_000 });
  const post = q.data?.items[0];
  if (!post) return null;
  return (
    <section aria-label="Promoted" className="mb-4">
      <PostCard post={post} promoted />
    </section>
  );
}

export function SpotlightRow() {
  const q = useQuery({ queryKey: ['promoted', 'spotlight'], queryFn: billingApi.spotlight, staleTime: 60_000 });
  const people = q.data?.people ?? [];
  if (people.length === 0) return null;
  return (
    <section aria-labelledby="spotlight-heading" className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="spotlight-heading" className="text-small font-semibold text-text-1">
          Spotlight
        </h2>
        <Pill variant="gold">Paid placement</Pill>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="Spotlight profiles">
        {people.map((p) => (
          <li key={p.username} className="shrink-0">
            <Link
              to={`/u/${p.username}`}
              className="flex w-28 flex-col items-center gap-2 rounded-panel border border-hairline-strong bg-surface-raised p-3 text-center hover:border-control-border"
            >
              <Avatar name={p.name} image={p.image} className="size-14 text-sm" />
              <span className="w-full truncate text-caption font-semibold text-text-1">{p.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
