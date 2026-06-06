"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGetJson } from "@/lib/api-client";
import { useSocketStore } from "@/stores/socket-store";

export interface MatchHistoryItem {
  matchId: string;
  playedAt: string;
  roomCategory: string;
  playerCount: number;
  rank: number;
  score: number;
  status: "WON" | "ELIMINATED" | "ABANDONED";
  durationSec: number;
}

interface MatchHistoryPage {
  items: MatchHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface UseMatchHistoryOptions {
  limit?: number;
}

export function useMatchHistory({ limit = 20 }: UseMatchHistoryOptions = {}) {
  const accessToken = useSocketStore((state) => state.accessToken);

  const query = useInfiniteQuery({
    queryKey: ["profile", "history", accessToken, limit],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(limit) });

      if (pageParam) {
        params.set("cursor", pageParam);
      }

      return apiGetJson<MatchHistoryPage>(
        `/api/v1/users/me/history?${params.toString()}`,
        accessToken ?? undefined,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}
