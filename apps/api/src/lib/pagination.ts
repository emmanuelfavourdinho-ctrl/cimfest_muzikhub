import type { Page, PageQuery } from '@muzikhub/shared';

/**
 * Cursor pagination on a stable ordering that ends in `id`. Fetches one extra row to
 * know whether another page exists. The cursor is the last item's id (opaque to clients).
 */
export async function paginate<T extends { id: string }>(
  query: PageQuery,
  fetchRows: (args: { take: number; cursor?: { id: string }; skip?: number }) => Promise<T[]>,
): Promise<Page<T>> {
  const rows = await fetchRows({
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { items: page.items.map(map), nextCursor: page.nextCursor };
}
