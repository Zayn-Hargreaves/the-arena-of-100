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

export function useProfileStats() {
  const accessToken = useSocketStore((state) => state.accessToken);

  return useQuery({
    queryKey: ["profile", "stats", accessToken],
    queryFn: () =>
      apiGetJson<ProfileStatsResponse>(
        "/api/v1/users/me/stats",
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
}
