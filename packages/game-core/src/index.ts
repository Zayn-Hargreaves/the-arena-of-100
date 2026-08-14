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

// Phase 2 — Class + Card Hybrid engines
export {
  sampleOffer,
  resolveCardEffect,
  resolveOptionDisable,
  resolveHandDestroy,
  correctOptionIndex,
  SAMPLE_OFFER_COUNT,
} from "./card-engine";
export type { SamplingStep, SamplingResult } from "./card-engine";
export { assignClasses } from "./class-engine";
export type { ClassAssignment } from "./class-engine";

// Topic Ban Voting Engine (Pre-match Crowd Draft)
export {
  selectCandidateTopics,
  tallyTopicVotes,
  resolveBannedTopics,
} from "./topic-voting";
export type { TopicVotingResult } from "./topic-voting";

// PRNG primitives
export {
  mulberry32,
  hashStringToSeed,
  seedFromString,
  deriveSubstream,
  sha256Bytes,
} from "./prng";

// Re-export shared types for convenience
export {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  GAME_CONFIG,
  ErrorCode,
  ERROR_MESSAGES,
} from "@arena/shared";
