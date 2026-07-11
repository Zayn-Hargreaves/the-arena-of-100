// ============================================================
// @arena/game-core - Main Entry Point
// Game Đấu Trường 100 - Core Game Logic
// ============================================================

// State Machine
export { MatchStateMachine } from "./match-state-machine";
export type { StateTransitionHandler } from "./match-state-machine";
export { eliminationsForRound, UNAVAILABLE } from "./round-elimination";
export type {
  RoundStartingPlayers,
  RoundWithEliminationInputs,
} from "./round-elimination";

// Pure domain scoring
export { computeRoundScore } from "./scoring";
export type { RoundScore } from "./scoring";

// Re-export shared types for convenience
export {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  GAME_CONFIG,
  ErrorCode,
  ERROR_MESSAGES,
} from "@arena/shared";
