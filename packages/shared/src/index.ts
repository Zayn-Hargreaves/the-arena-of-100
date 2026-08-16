// ============================================================
// @arena/shared - Main Entry Point
// Game Đấu Trường 100 - Shared Types & Constants
// ============================================================

// Events
export * from "./events";

// State Types
export * from "./state";

// Socket Protocol
export * from "./socket";

// Errors
export * from "./errors";

// Validation Schemas
export * from "./schemas";

// Avatar Seeds
export * from "./avatars";

// Admin Audit API contract (GET /admin/audit-events)
export * from "./audit";

// Classes (Phase 2 — Class + Card Hybrid, locked 2026-07-30)
export * from "./classes";

// Cards (Phase 2 — Class + Card Hybrid, locked 2026-07-30)
export * from "./cards";
export {
  deepFreeze,
  getImmutableSamplingVector,
  canonicalSerialize,
} from "./cards.sampling-vector-helpers";

// Class stats — profile stats contracts (class winrate + streak +
// cards played). Shared between `@arena/api` (DTO + Zod parser)
// and `@arena/web` (useClassStats hook + profile page).
export * from "./class-stats";

// ELO & Rank Tiers (Phase 4 — ELO Rating Engine)
export * from "./elo";

// Game Constants (defined in its own file so schemas.ts can
// import GAME_CONFIG.MAX_ROUNDS without creating a circular
// dependency through the index barrel).
export { GAME_CONFIG, MATCHMAKING_CONFIG } from "./game-config";
// Daily Challenge Constants (own file for the same reason as
// game-config: the API's Zod DTOs import it directly).
export { DAILY_QUESTION_COUNT } from "./daily-config";
import { GAME_CONFIG } from "./game-config";

export type QuestionCategory =
  | "GENERAL"
  | "SCIENCE"
  | "HISTORY"
  | "GEOGRAPHY"
  | "TECHNOLOGY"
  | "SPORTS"
  | "CULTURE"
  | "LOGIC";

export type RoomCategory = "ALL" | QuestionCategory;

export interface RoomCategoryOption {
  value: RoomCategory;
  label: string;
}

export const ROOM_CATEGORY_OPTIONS: readonly RoomCategoryOption[] = [
  { value: "ALL", label: "profile.roomCategory.ALL" },
  { value: "SCIENCE", label: "profile.roomCategory.SCIENCE" },
  { value: "HISTORY", label: "profile.roomCategory.HISTORY" },
  { value: "GEOGRAPHY", label: "profile.roomCategory.GEOGRAPHY" },
  { value: "TECHNOLOGY", label: "profile.roomCategory.TECHNOLOGY" },
  { value: "SPORTS", label: "profile.roomCategory.SPORTS" },
  { value: "CULTURE", label: "profile.roomCategory.CULTURE" },
  { value: "LOGIC", label: "profile.roomCategory.LOGIC" },
] as const;

// Room Code Alphabet (excluding ambiguous chars: 0, O, I, 1, l)
export const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Generate Room Code (Strategy Pattern - can be swapped)
export function generateRoomCode(
  length = GAME_CONFIG.ROOM_CODE_LENGTH,
): string {
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[array[i]! % ROOM_CODE_CHARS.length];
  }
  return code;
}

// Error Codes
export { ErrorCode } from "./error-codes";
import { ErrorCode } from "./error-codes";

// Error Messages (Vietnamese) — i18n keys, NOT display strings.
// Every server-side emitter writes the matching key into
// `ErrorPayload.message` and the client translates by code at
// the locale-aware layer. This avoids hardcoded English leaking
// into localized UIs and keeps the wire contract a stable set of
// `Errors.*` / `Cards.errors.*` keys.
export const ERROR_MESSAGE_KEYS: Record<ErrorCode, string> = {
  [ErrorCode.ROOM_NOT_FOUND]: "Errors.ROOM_NOT_FOUND",
  [ErrorCode.ROOM_FULL]: "Errors.ROOM_FULL",
  [ErrorCode.ROOM_ALREADY_STARTED]: "Errors.ROOM_ALREADY_STARTED",
  [ErrorCode.PLAYER_NOT_IN_ROOM]: "Errors.PLAYER_NOT_IN_ROOM",
  [ErrorCode.MATCH_NOT_FOUND]: "Errors.MATCH_NOT_FOUND",
  [ErrorCode.MATCH_ALREADY_STARTED]: "Errors.MATCH_ALREADY_STARTED",
  [ErrorCode.ROUND_NOT_ACTIVE]: "Errors.ROUND_NOT_ACTIVE",
  [ErrorCode.ALREADY_ANSWERED]: "Errors.ALREADY_ANSWERED",
  [ErrorCode.ANSWER_SUBMISSION_CLOSED]: "Errors.ANSWER_SUBMISSION_CLOSED",
  [ErrorCode.UNAUTHORIZED]: "Errors.UNAUTHORIZED",
  [ErrorCode.INVALID_TOKEN]: "Errors.INVALID_TOKEN",
  [ErrorCode.RATE_LIMITED]: "Errors.RATE_LIMITED",
  [ErrorCode.INTERNAL_ERROR]: "Errors.INTERNAL_ERROR",
  [ErrorCode.NOT_ROOM_HOST]: "Errors.NOT_ROOM_HOST",
  [ErrorCode.NOT_ENOUGH_PLAYERS]: "Errors.NOT_ENOUGH_PLAYERS",
  [ErrorCode.INVALID_ROOM_TYPE]: "Errors.INVALID_ROOM_TYPE",
  [ErrorCode.SPECTATOR_CANNOT_ANSWER]: "Errors.SPECTATOR_CANNOT_ANSWER",
  [ErrorCode.INVALID_PAYLOAD]: "Errors.INVALID_PAYLOAD",
  [ErrorCode.PLAYER_DISCONNECTED]: "Errors.PLAYER_DISCONNECTED",
  [ErrorCode.COMMAND_ID_CONFLICT]: "Cards.errors.commandIdConflict",
  [ErrorCode.AOE_CAP_EXHAUSTED]: "Cards.errors.aoeCapExhausted",
  [ErrorCode.CARD_NOT_IN_HAND]: "Cards.errors.cardNotInHand",
  [ErrorCode.CARD_NOT_FOUND]: "Cards.errors.cardNotFound",
  [ErrorCode.INVALID_COMMAND_ID]: "Cards.errors.invalidCommandId",
  [ErrorCode.TOPIC_VOTING_CLOSED]: "Errors.TOPIC_VOTING_CLOSED",
  [ErrorCode.INVALID_TOPIC]: "Errors.INVALID_TOPIC",
};

// Backwards-compatible alias — callers still see ERROR_MESSAGES
// even though the contract is now a key-based contract.
export const ERROR_MESSAGES = ERROR_MESSAGE_KEYS;
