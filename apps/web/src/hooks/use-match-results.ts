import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AvatarSeed } from "@arena/shared";
import { API_URL } from "@/lib/api";
import { findAvatarBySeed } from "@/lib/avatars";

export interface MatchResultApiResponse {
  winnerId?: string | null;
  status?: string;
  rounds?: Array<{ id?: string; roundNo?: number }>;
  answers?: Array<{
    userId?: string;
    roundId?: string;
    isCorrect?: boolean;
    responseTimeMs?: number;
  }>;
  players?: Array<{
    userId?: string;
    score?: number;
    rank?: number | null;
    placement?: number | null;
    eloBefore?: number | null;
    eloAfter?: number | null;
    eloDelta?: number | null;
    user?: { id?: string; username?: string; avatar?: string; elo?: number };
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
  eloDelta?: number | null;
  eloAfter?: number | null;
  isWinner: boolean;
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

/**
 * Fetch the match result in a single round-trip with a SHARED abort
 * controller. The same controller is wired into `fetch()` and is
 * consulted by the body reader downstream, so a timeout (or an external
 * abort) propagates through BOTH the network request and the response
 * body read — the in-flight `ReadableStream` sees the abort, not just
 * the surrounding `Promise.race` wrapper.
 *
 * Returns the response + parsed payload + whether the request timed
 * out. A network-phase timeout surfaces as `{ response, data: null,
 * wasTimeout: true }` (same response shape as a body-phase timeout);
 * the caller does not need to distinguish the two — both are "the user
 * should retry" outcomes.
 */
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
    // If the timer fired during fetch, the controller is already
    // aborted. Skip body parsing — `response.json()` would either
    // reject immediately (if the body is already locked) or hang
    // (if the body is still streaming). Either way we treat it as
    // a timeout outcome.
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
    // Runs AFTER both phases settle (network + body parse). Until
    // this point, `request.signal` remains live so a timer-driven
    // abort can still cancel the streaming body reader.
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
        // External abort between status check and now — skip silently.
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

  const players = useMemo(
    () =>
      (payload?.players ?? []).map((player) => ({
        id: player.userId ?? player.user?.id ?? "",
        name: player.user?.username,
        score: player.score ?? 0,
      })),
    [payload?.players],
  );

  const getPlayerEliminatedRound = useCallback(
    (playerId: string) => {
      const playerAnswers = (payload?.answers ?? []).filter(
        (a) => a.userId === playerId,
      );
      const wrongAnswer = playerAnswers.find((a) => !a.isCorrect);
      if (wrongAnswer && payload?.rounds) {
        const roundIdx = payload.rounds.findIndex(
          (r) => r.id === wrongAnswer.roundId,
        );
        if (roundIdx !== -1) {
          return payload.rounds[roundIdx]?.roundNo ?? roundIdx + 1;
        }
      }
      // If winner or never eliminated
      if (payload?.winnerId && payload.winnerId === playerId) {
        return (payload?.rounds?.length ?? 1) + 1;
      }
      return 0;
    },
    [payload?.answers, payload?.rounds, payload?.winnerId],
  );

  const sortedPlayers = useMemo(
    () =>
      [...players].sort((a, b) => {
        // 1. Winner is always first
        const aIsWinner = Boolean(
          payload?.winnerId && payload.winnerId === a.id,
        );
        const bIsWinner = Boolean(
          payload?.winnerId && payload.winnerId === b.id,
        );
        if (aIsWinner && !bIsWinner) return -1;
        if (!aIsWinner && bIsWinner) return 1;

        // 2. Higher survived/elimination round
        const aRound = getPlayerEliminatedRound(a.id);
        const bRound = getPlayerEliminatedRound(b.id);
        if (bRound !== aRound) return bRound - aRound;

        // 3. Higher score
        if (b.score !== a.score) return b.score - a.score;

        return a.id.localeCompare(b.id);
      }),
    [players, payload?.winnerId, getPlayerEliminatedRound],
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

  const rawPlayerById = useMemo(
    () =>
      new Map(
        (payload?.players ?? []).map((p) => [p.userId ?? p.user?.id ?? "", p]),
      ),
    [payload?.players],
  );

  const getPlayerMetrics = useCallback(
    (playerId: string) => {
      const playerAnswers = (payload?.answers ?? []).filter(
        (a) => a.userId === playerId,
      );
      const totalAnswers = playerAnswers.length;
      const correctAnswers = playerAnswers.filter((a) => a.isCorrect).length;
      const accuracy =
        totalAnswers > 0
          ? `${Math.round((correctAnswers / totalAnswers) * 100)}%`
          : "--";
      const totalTimeMs = playerAnswers.reduce(
        (acc, a) => acc + (a.responseTimeMs ?? 0),
        0,
      );
      const avgSpeed =
        totalAnswers > 0
          ? `${(totalTimeMs / totalAnswers / 1000).toFixed(1)}s`
          : "--";

      const wrongAnswer = playerAnswers.find((a) => !a.isCorrect);
      let eliminatedRoundNo: number | null = null;
      if (wrongAnswer && payload?.rounds) {
        const roundIdx = payload.rounds.findIndex(
          (r) => r.id === wrongAnswer.roundId,
        );
        if (roundIdx !== -1) {
          eliminatedRoundNo = payload.rounds[roundIdx]?.roundNo ?? roundIdx + 1;
        }
      }

      return {
        accuracy,
        avgSpeed,
        correctAnswers,
        totalAnswers,
        eliminatedRoundNo,
      };
    },
    [payload?.answers, payload?.rounds],
  );

  const winner = useMemo<WinnerViewModel>(() => {
    const winnerId = payload?.winnerId ?? null;
    const winnerFromServer = winnerId ? playerById.get(winnerId) : null;
    const rawWinner = winnerId ? rawPlayerById.get(winnerId) : null;
    const winnerAvatarSeed =
      (rawWinner?.user?.avatar as AvatarSeed) || "jellyfrog";
    const winnerAvatarOpt = findAvatarBySeed(winnerAvatarSeed);
    const winnerSpritesheet =
      winnerAvatarOpt?.spritesheet ||
      "/arena_of_100/jellyfrog_spritesheet.webp";
    const totalRounds = payload?.rounds?.length ?? 1;

    if (!winnerFromServer) {
      return {
        name: payload?.winnerId
          ? t("guestPlayer")
          : payload?.status === "FINISHED"
            ? t("noWinner")
            : t("updating"),
        spritesheet: winnerSpritesheet,
        isAnimated: true,
        totalScore: 0,
        averageSpeed: "--",
        accuracy: "--",
        survivedRounds: `${Math.max(1, totalRounds)}`,
      };
    }
    const metrics = getPlayerMetrics(winnerFromServer.id);
    const score = winnerFromServer.score ?? 0;
    return {
      name:
        winnerFromServer.name ??
        (payload?.winnerId ? t("guestPlayer") : t("updating")),
      spritesheet: winnerSpritesheet,
      isAnimated: true,
      totalScore: score,
      averageSpeed: metrics.avgSpeed,
      accuracy: metrics.accuracy,
      survivedRounds: `${Math.max(1, totalRounds)}`,
    };
  }, [
    playerById,
    rawPlayerById,
    payload?.winnerId,
    payload?.status,
    payload?.rounds,
    getPlayerMetrics,
    t,
  ]);

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
            const matchedPlayer = players.find(
              (p) => p.name?.toLowerCase() === storedCallsign.toLowerCase(),
            );
            if (matchedPlayer) {
              effectiveUserId = matchedPlayer.id;
            }
          }
        }
      } catch {
        // ignore localStorage access errors
      }
    }

    // Never invent identity from "first non-bot" / first leaderboard row —
    // that misattributes another player's rank/score/ELO as "you".
    const currentPlayer = effectiveUserId
      ? playerById.get(effectiveUserId)
      : undefined;
    const rawPlayer = currentPlayer
      ? rawPlayerById.get(currentPlayer.id)
      : undefined;
    const isWinner = Boolean(
      payload?.winnerId &&
      currentPlayer?.id &&
      payload.winnerId === currentPlayer.id,
    );

    let rank: number | null = null;
    if (currentPlayer) {
      const serverRank = playerRankById.get(currentPlayer.id);
      if (serverRank !== undefined && serverRank !== null) {
        rank = serverRank;
      } else if (isWinner) {
        rank = 1;
      } else {
        const idx = sortedPlayers.findIndex((p) => p.id === currentPlayer.id);
        rank =
          idx >= 0
            ? payload?.winnerId
              ? idx + 1 > 1
                ? idx + 1
                : 2
              : idx + 1
            : null;
      }
    }

    const score = currentPlayer?.score ?? 0;
    const metrics = currentPlayer
      ? getPlayerMetrics(currentPlayer.id)
      : { accuracy: "--", avgSpeed: "--", eliminatedRoundNo: null };

    const isEliminated =
      !isWinner &&
      (metrics.eliminatedRoundNo !== null ||
        (payload?.status === "FINISHED" && !isWinner));
    const eliminatedRound = isEliminated
      ? (metrics.eliminatedRoundNo ?? (payload?.rounds?.length || 1))
      : null;

    return {
      name: currentPlayer?.name ?? t("guestPlayer"),
      rank,
      score,
      speed: metrics.avgSpeed,
      accuracy: metrics.accuracy,
      eliminatedRound,
      eloDelta: rawPlayer?.eloDelta ?? null,
      eloAfter: rawPlayer?.eloAfter ?? null,
      isWinner,
    };
  }, [
    playerById,
    playerRankById,
    rawPlayerById,
    players,
    sortedPlayers,
    payload?.winnerId,
    payload?.status,
    payload?.rounds,
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
