"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGetJson } from "@/lib/api-client";
import { useSocketStore } from "@/stores/socket-store";

export interface UserSummary {
  id: string;
  username: string;
  avatar: string;
  role: "GUEST" | "ADMIN";
}

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
// Phase 3 — class winrate + streak + sabotage count hook
// ============================================================

export interface ClassWinrate {
  plays: number;
  wins: number;
  winRate: number;
}

export interface Phase3Stats {
  classWinrate: {
    CONG?: ClassWinrate;
    THU?: ClassWinrate;
  };
  currentStreak: number;
  sabotageCount: number;
}

export interface Phase3StatsResponse {
  stats: Phase3Stats;
}

export function usePhase3Stats() {
  const username = useSocketStore((state) => state.username);

  return useQuery({
    queryKey: ["profile", "phase3-stats", username],
    queryFn: () => {
      const token = useSocketStore.getState().accessToken;
      return apiGetJson<Phase3StatsResponse>(
        "/api/v1/users/me/phase3-stats",
        token ?? undefined,
      );
    },
    enabled: Boolean(username),
    staleTime: 60_000,
  });
}
