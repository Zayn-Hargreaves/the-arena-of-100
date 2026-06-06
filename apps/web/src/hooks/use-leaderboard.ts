"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGetJson } from "@/lib/api-client";

export type LeaderboardPeriod = "weekly" | "all";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string;
  wins: number;
  matchesPlayed: number;
  accuracy: number;
  avgResponseMs: number;
  totalScore: number;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  generatedAt: string;
  cached: boolean;
  items: LeaderboardEntry[];
}

interface UseLeaderboardOptions {
  period: LeaderboardPeriod;
  limit?: number;
}

export function useLeaderboard({ period, limit = 50 }: UseLeaderboardOptions) {
  return useQuery({
    queryKey: ["rankings", "leaderboard", period, limit],
    queryFn: () => {
      const params = new URLSearchParams({
        period,
        limit: String(limit),
      });
      return apiGetJson<LeaderboardResponse>(
        `/api/v1/rankings/leaderboard?${params.toString()}`,
      );
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
