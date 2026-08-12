import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";

export interface MatchResultApiResponse {
  winnerId?: string | null;
  players?: Array<{
    userId?: string;
    score?: number;
    user?: { id?: string; username?: string };
  }>;
}

export type ResultLoadState =
  | "loading"
  | "ready"
  | "not_found"
  | "unauthorized"
  | "network_error";

export interface WinnerViewModel {
  name: string;
  spritesheet: string;
  isAnimated: boolean;
  totalScore: number;
  averageSpeed: string;
  accuracy: string;
  survivedRounds: string;
}

export interface PerformanceViewModel {
  name: string;
  rank: number | null;
  score: number;
  speed: string;
  accuracy: string;
  eliminatedRound?: number | null;
}

function buildRequestSignal(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchResultResponse(
  matchId: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const endpoint = `${API_URL}/matches/${encodeURIComponent(matchId)}`;
  const request = buildRequestSignal(signal, 10_000);
  try {
    return await fetch(endpoint, {
      credentials: "include",
      signal: request.signal,
    });
  } finally {
    request.cancel();
  }
}

export function useMatchResults(matchId: string, userId: string | null) {
  const t = useTranslations("Result.fallbacks");
  const [loadState, setLoadState] = useState<ResultLoadState>("loading");
  const [payload, setPayload] = useState<MatchResultApiResponse | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    async function fetchResults() {
      setLoadState("loading");
      try {
        const response = await fetchResultResponse(
          matchId,
          abortController.signal,
        );
        if (!response) {
          setLoadState("network_error");
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setLoadState("unauthorized");
          return;
        }
        if (response.status === 404) {
          setLoadState("not_found");
          return;
        }
        if (!response.ok) {
          setLoadState("network_error");
          return;
        }
        setPayload((await response.json()) as MatchResultApiResponse);
        setLoadState("ready");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadState("network_error");
      }
    }

    void fetchResults();
    return () => abortController.abort();
  }, [matchId, retryToken]);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  const players = useMemo(
    () =>
      (payload?.players ?? []).map((player) => ({
        id: player.userId ?? player.user?.id ?? "",
        name: player.user?.username,
        score: player.score ?? 0,
      })),
    [payload?.players],
  );
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );

  const winner = useMemo<WinnerViewModel>(() => {
    const topPlayer = sortedPlayers[0];
    return {
      name: topPlayer?.name ?? t("updating"),
      spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
      isAnimated: true,
      totalScore: topPlayer?.score ?? 0,
      averageSpeed: "--",
      accuracy: "--",
      survivedRounds: "--",
    };
  }, [sortedPlayers, t]);

  const yourPerformance = useMemo<PerformanceViewModel>(() => {
    const currentPlayer = userId
      ? players.find((player) => player.id === userId)
      : undefined;
    return {
      name: currentPlayer?.name ?? t("guestPlayer"),
      rank: currentPlayer
        ? sortedPlayers.findIndex((player) => player.id === currentPlayer.id) +
            1 || null
        : null,
      score: currentPlayer?.score ?? 0,
      speed: "--",
      accuracy: "--",
      eliminatedRound: null,
    };
  }, [players, sortedPlayers, t, userId]);

  const winnerId = payload?.winnerId ?? null;
  const opponents = winnerId
    ? players.filter((player) => player.id !== winnerId).length
    : Math.max(0, players.length - 1);

  return { loadState, winner, yourPerformance, opponents, retry };
}
