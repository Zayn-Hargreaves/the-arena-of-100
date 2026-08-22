"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGetJson } from "@/lib/api-client";
import { useSocketStore } from "@/stores/socket-store";
import type { ClassStatsResponse, UserSummary } from "@arena/shared";

export type { UserSummary };

export interface ProfileStats {
  matchesPlayed: number;
  wins: number;
  totalScore: number;
  avgResponseMs: number;
  accuracy: number;
  winRate: number;
  survivalRate: number;
  totalCorrectAnswers: number;
}

export interface ProfileStatsResponse {
  user: UserSummary;
  stats: ProfileStats;
}

// Use the non-secret username as the cache key separator between users
// so React Query Devtools + snapshots do not log access tokens. The
// token is still attached to each request inside queryFn via the
// socket store (read at request time, not in the cache key).
export function useProfileStats() {
  const username = useSocketStore((state) => state.username);

  return useQuery({
    queryKey: ["profile", "stats", username],
    queryFn: () => {
      const token = useSocketStore.getState().accessToken;
      return apiGetJson<ProfileStatsResponse>(
        "/api/v1/users/me/stats",
        token ?? undefined,
      );
    },
    enabled: Boolean(username),
    staleTime: 60_000,
  });
}

// ============================================================
// Class stats — class winrate + streak + cards played hook
// ============================================================
//
// `ClassWinrate`, `ClassStats`, `ClassStatsResponse` are imported
// from `@arena/shared` so the API DTO and this hook share one
// canonical Zod-derived type. Keep `@arena/web` free of
// `@arena/api` (web depends only on shared per the package boundary).

export function useClassStats() {
  const username = useSocketStore((state) => state.username);

  return useQuery({
    queryKey: ["profile", "class-stats", username],
    queryFn: () => {
      const token = useSocketStore.getState().accessToken;
      return apiGetJson<ClassStatsResponse>(
        "/api/v1/users/me/class-stats",
        token ?? undefined,
      );
    },
    enabled: Boolean(username),
    staleTime: 60_000,
  });
}
