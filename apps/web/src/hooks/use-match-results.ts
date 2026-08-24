import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";
import {
  calculatePlayerEliminatedRound,
  calculatePlayerMetrics,
  computePerformanceViewModel,
  computeWinnerViewModel,
  sortMatchPlayers,
  type PlayerMetrics,
  type SimplePlayer,
} from "@/lib/match-results-helpers";
import type {
  MatchResultApiResponse,
  PerformanceViewModel,
  ResultLoadState,
  WinnerViewModel,
} from "@/types/match-results-types";

export type {
  MatchResultApiResponse,
  PerformanceViewModel,
  ResultLoadState,
  WinnerViewModel,
};

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

export async function fetchResult(
  matchId: string,
  signal: AbortSignal,
): Promise<{
  response: Response | null;
  data: MatchResultApiResponse | null;
  wasTimeout: boolean;
}> {
  const endpoint = `${API_URL}/api/v1/matches/${encodeURIComponent(matchId)}`;
  const request = buildRequestSignal(signal, 10_000);
  try {
    const response = await fetch(endpoint, {
      credentials: "include",
      signal: request.signal,
    });
    if (request.signal.aborted) {
      return { response: null, data: null, wasTimeout: request.wasTimeout() };
    }
    const rawJson = (await response.json()) as
      | MatchResultApiResponse
      | { data?: MatchResultApiResponse; success?: boolean };
    const data =
      rawJson &&
      typeof rawJson === "object" &&
      "data" in rawJson &&
      rawJson.data
        ? (rawJson.data as MatchResultApiResponse)
        : (rawJson as MatchResultApiResponse);
    return { response, data, wasTimeout: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { response: null, data: null, wasTimeout: request.wasTimeout() };
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
        const { response, data, wasTimeout } = await fetchResult(
          matchId,
          abortController.signal,
        );
        if (wasTimeout) {
          setLoadState("network_error");
          return;
        }
        if (abortController.signal.aborted) return;
        if (!response) {
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
        if (abortController.signal.aborted) return;
        if (!data) {
          setLoadState("network_error");
          return;
        }
        setPayload(data);
        setLoadState("ready");
      } catch {
        if (!abortController.signal.aborted) {
          setLoadState("network_error");
        }
      }
    }

    void fetchResults();
    return () => abortController.abort();
  }, [matchId, retryToken]);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  const players = useMemo<SimplePlayer[]>(
    () =>
      (payload?.players ?? []).map((player) => ({
        id: player.userId ?? player.user?.id ?? "",
        name: player.user?.username,
        score: player.score ?? 0,
      })),
    [payload?.players],
  );

  const rawPlayerById = useMemo(
    () =>
      new Map(
        (payload?.players ?? []).map((p) => [p.userId ?? p.user?.id ?? "", p]),
      ),
    [payload?.players],
  );

  const metricsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerMetrics>();
    for (const player of players) {
      map.set(
        player.id,
        calculatePlayerMetrics(player.id, payload?.answers, payload?.rounds),
      );
    }
    return map;
  }, [players, payload?.answers, payload?.rounds]);

  const getPlayerMetrics = useCallback(
    (playerId: string) =>
      metricsByPlayerId.get(playerId) ??
      calculatePlayerMetrics(playerId, payload?.answers, payload?.rounds),
    [metricsByPlayerId, payload?.answers, payload?.rounds],
  );

  const getPlayerEliminatedRound = useCallback(
    (playerId: string) => {
      const metrics = getPlayerMetrics(playerId);
      return calculatePlayerEliminatedRound(
        playerId,
        metrics,
        payload?.rounds?.length ?? 1,
        payload?.winnerId,
      );
    },
    [getPlayerMetrics, payload?.rounds?.length, payload?.winnerId],
  );

  const sortedPlayers = useMemo(
    () => sortMatchPlayers(players, payload, getPlayerEliminatedRound),
    [players, payload, getPlayerEliminatedRound],
  );

  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const playerRankById = useMemo(
    () =>
      new Map(
        (payload?.players ?? []).map((p) => {
          const id = p.userId ?? p.user?.id ?? "";
          if (p.placement !== undefined && p.placement !== null) {
            return [id, p.placement];
          }
          if (p.rank !== undefined && p.rank !== null) {
            return [id, p.rank];
          }
          const computedRank =
            sortedPlayers.findIndex((sp) => sp.id === id) + 1;
          return [id, computedRank > 0 ? computedRank : null];
        }),
      ),
    [payload?.players, sortedPlayers],
  );

  const winner = useMemo<WinnerViewModel>(
    () =>
      computeWinnerViewModel(
        payload,
        playerById,
        rawPlayerById,
        getPlayerMetrics,
        t,
      ),
    [payload, playerById, rawPlayerById, getPlayerMetrics, t],
  );

  const yourPerformance = useMemo<PerformanceViewModel>(() => {
    let effectiveUserId = userId;
    if (!effectiveUserId && typeof window !== "undefined") {
      try {
        const storedUserId = localStorage.getItem("userId");
        if (storedUserId && playerById.has(storedUserId)) {
          effectiveUserId = storedUserId;
        } else {
          const storedCallsign = localStorage.getItem("callsign");
          if (storedCallsign) {
            const matchedPlayers = players.filter(
              (p) => p.name?.toLowerCase() === storedCallsign.toLowerCase(),
            );
            if (matchedPlayers.length === 1 && matchedPlayers[0]) {
              effectiveUserId = matchedPlayers[0].id;
            }
          }
        }
      } catch {
        // ignore localStorage access errors
      }
    }

    return computePerformanceViewModel(
      payload,
      effectiveUserId,
      playerById,
      playerRankById,
      rawPlayerById,
      sortedPlayers,
      getPlayerMetrics,
      t,
    );
  }, [
    playerById,
    playerRankById,
    rawPlayerById,
    players,
    sortedPlayers,
    payload,
    getPlayerMetrics,
    t,
    userId,
  ]);

  const winnerId = payload?.winnerId ?? null;
  const opponents = winnerId
    ? players.filter((player) => player.id !== winnerId).length
    : Math.max(0, players.length - 1);

  return { loadState, winner, yourPerformance, opponents, retry };
}
