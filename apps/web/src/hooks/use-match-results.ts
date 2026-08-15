import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";

export interface MatchResultApiResponse {
  winnerId?: string | null;
  players?: Array<{
    userId?: string;
    score?: number;
    rank?: number | null;
    placement?: number | null;
    eloBefore?: number | null;
    eloAfter?: number | null;
    eloDelta?: number | null;
    user?: { id?: string; username?: string; elo?: number };
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
  const endpoint = `${API_URL}/matches/${encodeURIComponent(matchId)}`;
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
    const data = (await response.json()) as MatchResultApiResponse;
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
  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const playerRankById = useMemo(
    () =>
      new Map(
        (payload?.players ?? []).map((p) => [
          p.userId ?? p.user?.id ?? "",
          p.rank ?? p.placement ?? null,
        ]),
      ),
    [payload?.players],
  );

  const rawPlayerById = useMemo(
    () =>
      new Map(
        (payload?.players ?? []).map((p) => [p.userId ?? p.user?.id ?? "", p]),
      ),
    [payload?.players],
  );

  const winner = useMemo<WinnerViewModel>(() => {
    const winnerId = payload?.winnerId ?? null;
    const winnerFromServer = winnerId ? playerById.get(winnerId) : undefined;
    // Only honor a server-provided winnerId that resolves to a known
    // player. A missing `payload.winnerId` (incomplete payload, race
    // with the finalization broadcast) or an unmatched id leaves the
    // view-model in the "updating" placeholder state — never infer a
    // champion from the first player in payload.players, which would fabricate a winner
    // the server has not declared.
    if (!winnerFromServer) {
      return {
        name: t("updating"),
        spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
        isAnimated: true,
        totalScore: 0,
        averageSpeed: "--",
        accuracy: "--",
        survivedRounds: "--",
      };
    }
    return {
      name: winnerFromServer.name ?? t("updating"),
      spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
      isAnimated: true,
      totalScore: winnerFromServer.score ?? 0,
      averageSpeed: "--",
      accuracy: "--",
      survivedRounds: "--",
    };
  }, [playerById, payload?.winnerId, t]);

  const yourPerformance = useMemo<PerformanceViewModel>(() => {
    const currentPlayer = userId ? playerById.get(userId) : undefined;
    const rawPlayer = userId ? rawPlayerById.get(userId) : undefined;
    return {
      name: currentPlayer?.name ?? t("guestPlayer"),
      rank: currentPlayer
        ? (playerRankById.get(currentPlayer.id) ?? null)
        : null,
      score: currentPlayer?.score ?? 0,
      speed: "--",
      accuracy: "--",
      eliminatedRound: null,
      eloDelta: rawPlayer?.eloDelta ?? null,
      eloAfter: rawPlayer?.eloAfter ?? null,
    };
  }, [playerById, playerRankById, rawPlayerById, t, userId]);

  const winnerId = payload?.winnerId ?? null;
  const opponents = winnerId
    ? players.filter((player) => player.id !== winnerId).length
    : Math.max(0, players.length - 1);

  return { loadState, winner, yourPerformance, opponents, retry };
}
