import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { FeedTab, Page, PostView } from '@muzikhub/shared';
import { api } from './api';
import { queryKeys } from './queries';

export const socialKeys = {
  feed: (tab: FeedTab) => ['feed', tab] as const,
  profilePosts: (username: string) => ['posts', 'profile', username.toLowerCase()] as const,
  profilePortfolio: (username: string) => ['portfolio', 'profile', username.toLowerCase()] as const,
  myPortfolio: (status?: string) => ['portfolio', 'mine', status ?? 'all'] as const,
  portfolioItem: (id: string) => ['portfolio', 'item', id] as const,
  post: (id: string) => ['post', id] as const,
  comments: (postId: string) => ['comments', postId] as const,
  relationship: (username: string) => ['relationship', username.toLowerCase()] as const,
  connections: (filter: string) => ['connections', filter] as const,
  follows: (username: string, which: string) => ['follows', username.toLowerCase(), which] as const,
  discoverPeople: (q: object) => ['discover', 'people', q] as const,
  discoverWork: (q: object) => ['discover', 'work', q] as const,
};

const nextPage = <T>(last: Page<T>) => last.nextCursor ?? undefined;
export const flatten = <T>(data: InfiniteData<Page<T>> | undefined): T[] => data?.pages.flatMap((p) => p.items) ?? [];

export function useFeed(tab: FeedTab, enabled = true) {
  return useInfiniteQuery({
    queryKey: socialKeys.feed(tab),
    queryFn: ({ pageParam }) => api.feed(tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
    enabled,
  });
}

export function useProfilePosts(username: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.profilePosts(username),
    queryFn: ({ pageParam }) => api.profilePosts(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
  });
}

export function useProfilePortfolio(username: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.profilePortfolio(username),
    queryFn: ({ pageParam }) => api.profilePortfolio(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
  });
}

export function useMyPortfolio(status?: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.myPortfolio(status),
    queryFn: ({ pageParam }) => api.myPortfolio(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
  });
}

export function usePortfolioItem(id: string | undefined) {
  return useQuery({ queryKey: socialKeys.portfolioItem(id ?? ''), queryFn: () => api.portfolioItem(id!), enabled: Boolean(id) });
}

export function useRelationship(username: string, enabled: boolean) {
  return useQuery({ queryKey: socialKeys.relationship(username), queryFn: () => api.relationship(username), enabled });
}

/** Content changed: refresh every list that might show it (cheap, and never shows stale state). */
export function useInvalidateContent() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['feed'] }),
      qc.invalidateQueries({ queryKey: ['posts'] }),
      qc.invalidateQueries({ queryKey: ['portfolio'] }),
      qc.invalidateQueries({ queryKey: ['discover'] }),
      qc.invalidateQueries({ queryKey: queryKeys.me }),
      qc.invalidateQueries({ queryKey: ['profile'] }),
    ]);
}

/** Replace one post wherever it appears in cached feeds (after like/edit), without refetching. */
export function useUpdateCachedPost() {
  const qc = useQueryClient();
  return (postId: string, patch: (p: PostView) => PostView) => {
    qc.setQueriesData<InfiniteData<Page<PostView>>>({ queryKey: ['feed'] }, (data) => mapPosts(data, postId, patch));
    qc.setQueriesData<InfiniteData<Page<PostView>>>({ queryKey: ['posts'] }, (data) => mapPosts(data, postId, patch));
    qc.setQueryData<PostView>(socialKeys.post(postId), (p) => (p ? patch(p) : p));
  };
}

function mapPosts(data: InfiniteData<Page<PostView>> | undefined, id: string, patch: (p: PostView) => PostView) {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((p) => (p.id === id ? patch(p) : p)) })) };
}

/** Like/unlike with an optimistic update that rolls back if the request fails. */
export function useToggleLike() {
  const update = useUpdateCachedPost();
  return useMutation({
    mutationFn: ({ post, liked }: { post: PostView; liked: boolean }) => api.setLike(post.id, liked),
    onMutate: ({ post, liked }) => {
      update(post.id, (p) => ({ ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) }));
      return { before: post };
    },
    onError: (_e, _v, ctx) => ctx && update(ctx.before.id, () => ctx.before),
    onSuccess: (state, { post }) => update(post.id, (p) => ({ ...p, likedByMe: state.liked, likeCount: state.likeCount })),
  });
}
