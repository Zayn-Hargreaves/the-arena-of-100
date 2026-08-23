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
