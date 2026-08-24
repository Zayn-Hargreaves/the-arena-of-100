import { resolveAvatar } from "@/lib/avatars";
import type {
  MatchResultApiResponse,
  PerformanceViewModel,
  WinnerViewModel,
} from "@/types/match-results-types";

export interface SimplePlayer {
  id: string;
  name?: string;
  score: number;
}

export interface PlayerMetrics {
  accuracy: string;
  avgSpeed: string;
  correctAnswers: number;
  totalAnswers: number;
  eliminatedRoundNo: number | null;
}

export function calculatePlayerMetrics(
  playerId: string,
  answers: MatchResultApiResponse["answers"] = [],
  rounds: MatchResultApiResponse["rounds"] = [],
): PlayerMetrics {
  const playerAnswers = (answers ?? []).filter((a) => a.userId === playerId);
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

  const wrongAnswers = playerAnswers.filter((a) => !a.isCorrect);
  let eliminatedRoundNo: number | null = null;
  if (wrongAnswers.length > 0 && rounds) {
    for (const wrong of wrongAnswers) {
      const roundIdx = rounds.findIndex((r) => r.id === wrong.roundId);
      if (roundIdx !== -1) {
        const rNo = rounds[roundIdx]?.roundNo ?? roundIdx + 1;
        if (eliminatedRoundNo === null || rNo < eliminatedRoundNo) {
          eliminatedRoundNo = rNo;
        }
      }
    }
  }

  return {
    accuracy,
    avgSpeed,
    correctAnswers,
    totalAnswers,
    eliminatedRoundNo,
  };
}

export function calculatePlayerEliminatedRound(
  playerId: string,
  metrics: PlayerMetrics,
  roundsCount: number,
  winnerId: string | null | undefined,
): number {
  if (metrics.eliminatedRoundNo !== null) {
    return metrics.eliminatedRoundNo;
  }
  if (winnerId && winnerId === playerId) {
    return roundsCount + 1;
  }
  return 0;
}

export function sortMatchPlayers(
  players: SimplePlayer[],
  payload: MatchResultApiResponse | null,
  getEliminatedRound: (playerId: string) => number,
): SimplePlayer[] {
  const totalTimeByPlayerId = new Map<string, number>();
  if (payload?.answers) {
    for (const ans of payload.answers) {
      if (ans.userId) {
        totalTimeByPlayerId.set(
          ans.userId,
          (totalTimeByPlayerId.get(ans.userId) ?? 0) +
            (ans.responseTimeMs ?? 0),
        );
      }
    }
  }

  const eliminatedRoundByPlayerId = new Map<string, number>();
  for (const player of players) {
    eliminatedRoundByPlayerId.set(player.id, getEliminatedRound(player.id));
  }

  return [...players].sort((a, b) => {
    // 1. Winner is always first
    const aIsWinner = Boolean(payload?.winnerId && payload.winnerId === a.id);
    const bIsWinner = Boolean(payload?.winnerId && payload.winnerId === b.id);
    if (aIsWinner && !bIsWinner) return -1;
    if (!aIsWinner && bIsWinner) return 1;

    // 2. Higher survived/elimination round
    const aRound = eliminatedRoundByPlayerId.get(a.id) ?? 0;
    const bRound = eliminatedRoundByPlayerId.get(b.id) ?? 0;
    if (bRound !== aRound) return bRound - aRound;

    // 3. Higher score
    if (b.score !== a.score) return b.score - a.score;

    // 4. Faster total response time as tie-breaker
    const aTotalTime = totalTimeByPlayerId.get(a.id) ?? 0;
    const bTotalTime = totalTimeByPlayerId.get(b.id) ?? 0;
    if (aTotalTime !== bTotalTime) return aTotalTime - bTotalTime;

    return a.id.localeCompare(b.id);
  });
}

export function computeWinnerViewModel(
  payload: MatchResultApiResponse | null,
  playerById: Map<string, SimplePlayer>,
  rawPlayerById: Map<
    string,
    NonNullable<MatchResultApiResponse["players"]>[number]
  >,
  getPlayerMetrics: (playerId: string) => PlayerMetrics,
  t: (key: string) => string,
): WinnerViewModel {
  const winnerId = payload?.winnerId ?? null;
  const winnerFromServer = winnerId ? playerById.get(winnerId) : null;
  const rawWinner = winnerId ? rawPlayerById.get(winnerId) : null;
  const winnerAvatarOpt = resolveAvatar(rawWinner?.user?.avatar);
  const winnerSpritesheet = winnerAvatarOpt.spritesheet ?? "";
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
      survivedRounds:
        payload?.status === "FINISHED" || payload?.winnerId
          ? `${Math.max(1, totalRounds)}`
          : "--",
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
}

export function computePerformanceViewModel(
  payload: MatchResultApiResponse | null,
  effectiveUserId: string | null,
  playerById: Map<string, SimplePlayer>,
  playerRankById: Map<string, number | null>,
  rawPlayerById: Map<
    string,
    NonNullable<MatchResultApiResponse["players"]>[number]
  >,
  sortedPlayers: SimplePlayer[],
  getPlayerMetrics: (playerId: string) => PlayerMetrics,
  t: (key: string) => string,
): PerformanceViewModel {
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
      if (idx >= 0) {
        const baseRank = idx + 1;
        rank = payload?.winnerId ? Math.max(2, baseRank) : baseRank;
      } else {
        rank = null;
      }
    }
  }

  const score = currentPlayer?.score ?? 0;
  const metrics = currentPlayer
    ? getPlayerMetrics(currentPlayer.id)
    : { accuracy: "--", avgSpeed: "--", eliminatedRoundNo: null };

  const isEliminated =
    Boolean(currentPlayer) &&
    !isWinner &&
    (metrics.eliminatedRoundNo !== null || payload?.status === "FINISHED");
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
}
