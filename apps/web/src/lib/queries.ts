import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, ReplaceLinksInput, UpdateProfileInput } from '@muzikhub/shared';
import { api, ApiRequestError } from './api';

export const queryKeys = {
  me: ['me'] as const,
  profile: (username: string) => ['profile', username.toLowerCase()] as const,
};

/**
 * The signed-in user, or null when signed out. A 401 is a normal answer here
 * (it means "signed out"), not an error.
 */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }): Promise<Me | null> => {
      try {
        return await api.me(signal);
      } catch (error) {
        if (error instanceof ApiRequestError && error.isUnauthenticated) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: queryKeys.profile(username),
    queryFn: ({ signal }) => api.profile(username, signal),
    retry: (count, error) => !(error instanceof ApiRequestError && error.status === 404) && count < 2,
  });
}

/** After any change to "me", refresh both the private and public views of the profile. */
function useSyncMe() {
  const queryClient = useQueryClient();
  return (me: Me) => {
    queryClient.setQueryData(queryKeys.me, me);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(me.profile.username) });
  };
}

export function useUpdateProfile() {
  const sync = useSyncMe();
  return useMutation({ mutationFn: (input: UpdateProfileInput) => api.updateProfile(input), onSuccess: sync });
}

export function useReplaceLinks() {
  const sync = useSyncMe();
  return useMutation({ mutationFn: (input: ReplaceLinksInput) => api.replaceLinks(input), onSuccess: sync });
}

export function useCompleteOnboarding() {
  const sync = useSyncMe();
  return useMutation({ mutationFn: () => api.completeOnboarding(), onSuccess: sync });
}
