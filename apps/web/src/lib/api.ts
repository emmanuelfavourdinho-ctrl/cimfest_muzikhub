import {
  API_V1_PREFIX,
  apiErrorSchema,
  commentPageSchema,
  commentSchema,
  connectionPageSchema,
  connectionSchema,
  followStateSchema,
  healthResponseSchema,
  likeStateSchema,
  mediaViewSchema,
  meSchema,
  personCardPageSchema,
  personPageSchema,
  portfolioItemSchema,
  portfolioPageSchema,
  postPageSchema,
  postSchema,
  publicProfileSchema,
  relationshipSchema,
  signedUploadSchema,
  type CreatePortfolioInput,
  type CreatePostInput,
  type CreateReportInput,
  type CreateUploadInput,
  type FeedTab,
  type ReplaceLinksInput,
  type UpdatePortfolioInput,
  type UpdateProfileInput,
} from '@muzikhub/shared';
import { z } from 'zod';
import { ApiRequestError } from './api-error';

export { ApiRequestError };

// Empty in development (Vite proxies /api). In production on Vercel, /api is rewritten to the API.
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

type Query = Record<string, string | number | string[] | undefined | null>;

function toQueryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${API_V1_PREFIX}${path}${toQueryString(init.query)}`, {
      method: init.method ?? 'GET',
      credentials: 'include', // send the session cookie
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiRequestError(0, 'NETWORK_ERROR', "Can't reach MuzikHub right now. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, details);
    }
    throw new ApiRequestError(res.status, 'UNEXPECTED_RESPONSE', 'Something went wrong. Please try again.');
  }
  // Validate responses too: a contract mismatch shows up as a clear error, not broken UI.
  return schema ? schema.parse(body) : (body as T);
}

const path = encodeURIComponent;

export const api = {
  health: (signal?: AbortSignal) => request('/health', healthResponseSchema, { signal }),

  // Me & profiles
  me: (signal?: AbortSignal) => request('/me', meSchema, { signal }),
  updateProfile: (input: UpdateProfileInput) => request('/me/profile', meSchema, { method: 'PATCH', body: input }),
  replaceLinks: (input: ReplaceLinksInput) => request('/me/profile/links', meSchema, { method: 'PUT', body: input }),
  setProfileImage: (slot: 'avatar' | 'cover', mediaId: string | null) =>
    request(`/me/profile/${slot}`, meSchema, { method: 'PUT', body: { mediaId } }),
  completeOnboarding: () => request('/me/onboarding/complete', meSchema, { method: 'POST' }),
  profile: (username: string, signal?: AbortSignal) => request(`/profiles/${path(username)}`, publicProfileSchema, { signal }),

  // Media
  createUpload: (input: CreateUploadInput) => request('/media/uploads', signedUploadSchema, { method: 'POST', body: input }),
  confirmUpload: (assetId: string) => request(`/media/${path(assetId)}/confirm`, mediaViewSchema, { method: 'POST' }),
  deleteUpload: (assetId: string) => request(`/media/${path(assetId)}`, null, { method: 'DELETE' }),

  // Portfolio
  profilePortfolio: (username: string, cursor?: string) =>
    request(`/profiles/${path(username)}/portfolio`, portfolioPageSchema, { query: { cursor } }),
  myPortfolio: (status: string | undefined, cursor?: string) =>
    request('/me/portfolio', portfolioPageSchema, { query: { status, cursor } }),
  portfolioItem: (id: string) => request(`/portfolio/${path(id)}`, portfolioItemSchema),
  createPortfolio: (input: CreatePortfolioInput) => request('/portfolio', portfolioItemSchema, { method: 'POST', body: input }),
  updatePortfolio: (id: string, input: UpdatePortfolioInput) =>
    request(`/portfolio/${path(id)}`, portfolioItemSchema, { method: 'PATCH', body: input }),
  publishPortfolio: (id: string, shareToFeed: boolean) =>
    request(`/portfolio/${path(id)}/publish`, portfolioItemSchema, { method: 'POST', body: { shareToFeed } }),
  archivePortfolio: (id: string) => request(`/portfolio/${path(id)}/archive`, portfolioItemSchema, { method: 'POST' }),
  deletePortfolio: (id: string) => request(`/portfolio/${path(id)}`, null, { method: 'DELETE' }),

  // Feed
  feed: (tab: FeedTab, cursor?: string) => request('/feed', postPageSchema, { query: { tab, cursor } }),
  profilePosts: (username: string, cursor?: string) => request(`/profiles/${path(username)}/posts`, postPageSchema, { query: { cursor } }),
  post: (id: string) => request(`/posts/${path(id)}`, postSchema),
  createPost: (input: CreatePostInput) => request('/posts', postSchema, { method: 'POST', body: input }),
  updatePost: (id: string, body: string) => request(`/posts/${path(id)}`, postSchema, { method: 'PATCH', body: { body } }),
  deletePost: (id: string) => request(`/posts/${path(id)}`, null, { method: 'DELETE' }),
  setLike: (id: string, liked: boolean) => request(`/posts/${path(id)}/like`, likeStateSchema, { method: liked ? 'PUT' : 'DELETE' }),
  comments: (postId: string, cursor?: string) => request(`/posts/${path(postId)}/comments`, commentPageSchema, { query: { cursor } }),
  addComment: (postId: string, body: string) =>
    request(`/posts/${path(postId)}/comments`, commentSchema, { method: 'POST', body: { body } }),
  deleteComment: (id: string) => request(`/comments/${path(id)}`, null, { method: 'DELETE' }),
  report: (input: CreateReportInput) => request('/reports', null, { method: 'POST', body: input }),

  // Network
  relationship: (username: string) => request(`/users/${path(username)}/relationship`, relationshipSchema),
  setFollow: (username: string, following: boolean) =>
    request(`/users/${path(username)}/follow`, followStateSchema, { method: following ? 'PUT' : 'DELETE' }),
  follows: (username: string, which: 'followers' | 'following', cursor?: string) =>
    request(`/users/${path(username)}/${which}`, personPageSchema, { query: { cursor } }),
  connections: (filter: 'incoming' | 'outgoing' | 'accepted', cursor?: string) =>
    request('/connections', connectionPageSchema, { query: { filter, cursor } }),
  requestConnection: (username: string, message?: string) =>
    request('/connections', connectionSchema, { method: 'POST', body: { username, message } }),
  connectionAction: (id: string, action: 'accept' | 'decline' | 'cancel' | 'remove') =>
    action === 'remove'
      ? request(`/connections/${path(id)}`, connectionSchema, { method: 'DELETE' })
      : request(`/connections/${path(id)}/${action}`, connectionSchema, { method: 'POST' }),

  // Discovery
  discoverPeople: (q: { q?: string; roles?: string[]; genres?: string[]; location?: string; cursor?: string }) =>
    request('/discover/people', personCardPageSchema, { query: q }),
  discoverWork: (q: { q?: string; types?: string[]; genres?: string[]; cursor?: string }) =>
    request('/discover/work', portfolioPageSchema, { query: q }),
};

/** Human-readable message for any error thrown by the API client or auth client. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
