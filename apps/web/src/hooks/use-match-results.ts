import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";

export interface MatchResultApiResponse {
  winner?: {
    userId?: string;
    name?: string;
    avatarSeed?: string;
    spritesheet?: string;
    isAnimated?: boolean;
    totalScore?: number;
    averageSpeed?: string;
    accuracy?: string;
    survivedRounds?: string;
  };
  yourPerformance?: {
    userId?: string;
    name?: string;
    rank?: number;
    score?: number;
    speed?: string;
    accuracy?: string;
    eliminatedRound?: number | null;
  };
  players?: Array<{
    userId?: string;
    score?: number;
    user?: { id?: string; username?: string };
  }>;
  winnerId?: string | null;
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
      name:
        payload?.winner?.name ??
        topPlayer?.name ??
        (topPlayer ? t("unknownPlayer") : t("updating")),
      spritesheet:
        payload?.winner?.spritesheet ??
        "/arena_of_100/jellyfrog_spritesheet.webp",
      isAnimated: payload?.winner?.isAnimated ?? true,
      totalScore: payload?.winner?.totalScore ?? topPlayer?.score ?? 0,
      averageSpeed: payload?.winner?.averageSpeed ?? "--",
      accuracy: payload?.winner?.accuracy ?? "--",
      survivedRounds: payload?.winner?.survivedRounds ?? "--",
    };
  }, [payload?.winner, sortedPlayers, t]);

  const yourPerformance = useMemo<PerformanceViewModel>(() => {
    if (payload?.yourPerformance) {
      return {
        name: payload.yourPerformance.name ?? t("guestPlayer"),
        rank: payload.yourPerformance.rank ?? null,
        score: payload.yourPerformance.score ?? 0,
        speed: payload.yourPerformance.speed ?? "--",
        accuracy: payload.yourPerformance.accuracy ?? "--",
        eliminatedRound: payload.yourPerformance.eliminatedRound,
      };
    }
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
  }, [payload?.yourPerformance, players, sortedPlayers, t, userId]);

  const winnerId = payload?.winner?.userId ?? payload?.winnerId;
  const opponents = winnerId
    ? players.filter((player) => player.id !== winnerId).length
    : Math.max(0, players.length - 1);

  return { loadState, winner, yourPerformance, opponents, retry };
}

async function fetchResultResponse(
  matchId: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const endpoints = [
    `${API_URL}/matches/${matchId}/results`,
    `${API_URL}/matches/${matchId}`,
  ];
  let response: Response | null = null;
  for (const endpoint of endpoints) {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(10_000),
    ]);
    response = await fetch(endpoint, {
      credentials: "include",
      signal: requestSignal,
    });
    if (response.status !== 404) break;
  }
  return response;
}
