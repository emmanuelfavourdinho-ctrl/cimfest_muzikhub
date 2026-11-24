import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from './primitives';

/**
 * Progressive loading: fetches the next page when the sentinel scrolls near the viewport,
 * with a visible "Load more" button as a fallback (and for keyboard/screen-reader users).
 */
export function InfiniteList({
  children,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isError,
}: {
  children: ReactNode;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  isError?: boolean;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || isError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isError]);

  return (
    <>
      {children}
      <div ref={sentinel} className="flex justify-center py-6">
        {isFetchingNextPage ? (
          <Spinner label="Loading more" />
        ) : hasNextPage ? (
          <Button variant="outline" size="sm" onClick={fetchNextPage}>
            {isError ? 'Retry loading more' : 'Load more'}
          </Button>
        ) : null}
      </div>
    </>
  );
}
