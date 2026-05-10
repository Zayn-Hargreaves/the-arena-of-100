// ============================================================
// @arena/game-core - Main Entry Point
// Game Đấu Trường 100 - Core Game Logic
// ============================================================

// State Machine
export { MatchStateMachine } from './match-state-machine';
export type { StateTransitionHandler } from './match-state-machine';

// Re-export shared types for convenience
export {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  GAME_CONFIG,
  ErrorCode,
  ERROR_MESSAGES,
} from '@arena/shared';