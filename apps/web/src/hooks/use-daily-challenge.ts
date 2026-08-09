"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDailyLeaderboard,
  getDailyToday,
  submitDaily,
} from "@/lib/api/daily";
import type {
  DailySubmitInput,
  DailySubmitResponse,
  DailyTodayResponse,
} from "@/types/daily";
import { useSocketStore } from "@/stores/socket-store";

const DAILY_TODAY_KEY = ["daily", "today"] as const;
const DAILY_LEADERBOARD_KEY = ["daily", "leaderboard"] as const;

/**
 * Schedule a `resetQueries` on `DAILY_TODAY_KEY` at the moment of
 * the next daily reset. The active tab then refetches on its next
 * render so the new day's question set, session token, and
 * `alreadyAttempted` flag all come fresh from the server.
 *
 * `resetQueries` (not `removeQueries`) is required: the page pins
 * `staleTime: Infinity` and disables background refetches, so the
 * mounted observer must be explicitly notified and refetched —
 * `removeQueries` would silently drop the cache without telling the
 * page, leaving it showing yesterday's questions.
 *
 * The schedule is a one-shot — we do NOT keep a long-lived timer; the
 * side effect just queues a single `setTimeout` and unmounts.
 */
function useInvalidateAtReset(nextResetAtIso: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!nextResetAtIso) return;
    const targetMs = new Date(nextResetAtIso).getTime();
    if (!Number.isFinite(targetMs)) return;
    const delay = Math.max(0, targetMs - Date.now());
    const id = window.setTimeout(() => {
      queryClient.resetQueries({ queryKey: DAILY_TODAY_KEY });
    }, delay);
    return () => window.clearTimeout(id);
  }, [nextResetAtIso, queryClient]);
}

/**
 * Fetches today's challenge. `staleTime: Infinity` and
 * `refetchOnWindowFocus: false` are deliberate: the server
 * pins the session start on the FIRST fetch (see
 * `apps/api/src/modules/daily/daily.service.ts`), so any
 * subsequent refetch mints a NEW `sessionToken` whose clock
 * has been reset. The session token is the only handle on the
 * measured session, so we must NOT hand the page a second one
 * while a quiz is in flight.
 *
 * A separate one-shot timer (`useInvalidateAtReset`) clears the
 * cache at `nextResetAt` so the new day's question set is
 * available without a full page reload.
 */
export function useDailyToday() {
  const accessToken = useSocketStore((state) => state.accessToken);

  const query = useQuery<DailyTodayResponse>({
    queryKey: [...DAILY_TODAY_KEY, accessToken ?? "anon"],
    queryFn: () => getDailyToday(accessToken ?? undefined),
    enabled: true,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  useInvalidateAtReset(query.data?.nextResetAt);

  return query;
}

interface SubmitDailyArgs {
  body: DailySubmitInput;
  /** Auth token required by the server (POST is authenticated). */
  token: string;
}

export function useSubmitDaily() {
  const queryClient = useQueryClient();

  return useMutation<DailySubmitResponse, Error, SubmitDailyArgs>({
    mutationFn: ({ body, token }) => submitDaily(body, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DAILY_TODAY_KEY });
      queryClient.invalidateQueries({ queryKey: DAILY_LEADERBOARD_KEY });
    },
  });
}

interface UseDailyLeaderboardOptions {
  dateKey?: string;
  limit?: number;
}

export function useDailyLeaderboard(options: UseDailyLeaderboardOptions = {}) {
  return useQuery({
    queryKey: [
      ...DAILY_LEADERBOARD_KEY,
      options.dateKey ?? "today",
      options.limit ?? 50,
    ],
    queryFn: () => getDailyLeaderboard(options),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
