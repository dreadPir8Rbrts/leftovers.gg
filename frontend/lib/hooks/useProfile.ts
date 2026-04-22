/**
 * React Query hook for the authenticated user's profile.
 * Deduplicates across components — only one fetch per session.
 * staleTime 5 min: profile data rarely changes, no need to refetch on every focus.
 */

import { useQuery } from "@tanstack/react-query";
import { getProfile } from "@/lib/api/profiles";

export function useProfile({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["profile"],
    queryFn: getProfile,
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled,
  });
}
