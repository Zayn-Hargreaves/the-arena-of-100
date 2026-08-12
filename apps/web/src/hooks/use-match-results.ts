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
): { signal: AbortSignal; cancel: () => void; wasTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    },
    wasTimeout: () => timedOut,
  };
}

export async function fetchResultResponse(
  matchId: string,
  signal: AbortSignal,
): Promise<{ response: Response | null; wasTimeout: boolean }> {
  const endpoint = `${API_URL}/matches/${encodeURIComponent(matchId)}`;
  const request = buildRequestSignal(signal, 10_000);
  try {
    const response = await fetch(endpoint, {
      credentials: "include",
      signal: request.signal,
    });
    return { response, wasTimeout: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { response: null, wasTimeout: request.wasTimeout() };
    }
    throw error;
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
        const { response, wasTimeout } = await fetchResultResponse(
          matchId,
          abortController.signal,
        );
        // Timeout abort: surface as network_error so the UI can retry.
        if (wasTimeout) {
          setLoadState("network_error");
          return;
        }
        // External abort between fetch resolve and now — skip silently so a
        // stale request never overwrites state after cleanup.
        if (abortController.signal.aborted) return;
        if (!response) {
          // External abort (cleanup) — keep silent, no state change needed.
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
        // Guard both sides of response.json(): abort may fire while parsing.
        if (abortController.signal.aborted) return;
        const data = (await response.json()) as MatchResultApiResponse;
        if (abortController.signal.aborted) return;
        setPayload(data);
        setLoadState("ready");
      } catch {
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
    const winnerId = payload?.winnerId ?? null;
    const winnerFromServer = winnerId
      ? players.find((player) => player.id === winnerId)
      : undefined;
    const topPlayer = winnerFromServer ?? sortedPlayers[0];
    return {
      name: topPlayer?.name ?? t("updating"),
      spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
      isAnimated: true,
      totalScore: topPlayer?.score ?? 0,
      averageSpeed: "--",
      accuracy: "--",
      survivedRounds: "--",
    };
  }, [sortedPlayers, players, payload?.winnerId, t]);

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
