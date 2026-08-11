import { useEffect, useMemo, useState } from "react";
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

export function useMatchResults(matchId: string, userId: string | null) {
  const t = useTranslations("Result.fallbacks");
  const [loadState, setLoadState] = useState<ResultLoadState>("loading");
  const [payload, setPayload] = useState<MatchResultApiResponse | null>(null);

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
  }, [matchId]);

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

  const winner = useMemo(() => {
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

  const yourPerformance = useMemo(() => {
    if (payload?.yourPerformance) {
      return {
        name: payload.yourPerformance.name ?? t("guestPlayer"),
        rank: payload.yourPerformance.rank ?? 0,
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
          1
        : 0,
      score: currentPlayer?.score ?? 0,
      speed: "--",
      accuracy: "--",
      eliminatedRound: null,
    };
  }, [payload?.yourPerformance, players, sortedPlayers, t, userId]);

  return { loadState, winner, yourPerformance };
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
    response = await fetch(endpoint, { credentials: "include", signal });
    if (response.status !== 404) break;
  }
  return response;
}
