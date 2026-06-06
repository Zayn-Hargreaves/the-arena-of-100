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

// Avatar Seeds
export * from "./avatars";

// Game Constants
export const GAME_CONFIG = {
  MAX_PLAYERS: 100,
  MIN_PLAYERS_TO_START: 2,
  ROUND_DURATION_MS: 15_000, // 15 seconds per round
  COUNTDOWN_DURATION_MS: 5_000, // 5 seconds countdown
  RESULT_DISPLAY_MS: 3_000, // 3 seconds to show result
  MAX_ROUNDS: 50, // Safety limit
  ROOM_CODE_LENGTH: 6,
  // Scoring: each correct answer grants base + speed bonus
  // total = SCORE_BASE_CORRECT + max(0, (WINDOW - responseTimeMs) / DIVISOR)
  // Max bonus: 50 (when responseTime = 0)
  // Min bonus: 0  (when responseTime >= WINDOW)
  SCORE_BASE_CORRECT: 100,
  SCORE_SPEED_BONUS_WINDOW_MS: 10_000,
  SCORE_SPEED_BONUS_DIVISOR: 200,
} as const;

// Compute round score for a single correct answer.
// Returns base, speedBonus, and total. Incorrect answers earn 0 (caller should not invoke).
export function computeRoundScore(responseTimeMs: number): {
  base: number;
  speedBonus: number;
  total: number;
} {
  const base = GAME_CONFIG.SCORE_BASE_CORRECT;
  const clamped = Math.max(0, responseTimeMs);
  const raw = Math.max(0, GAME_CONFIG.SCORE_SPEED_BONUS_WINDOW_MS - clamped);
  const speedBonus = raw / GAME_CONFIG.SCORE_SPEED_BONUS_DIVISOR;
  return { base, speedBonus, total: base + speedBonus };
}

export type RoomCategory =
  | "ALL"
  | "SCIENCE"
  | "HISTORY"
  | "TECHNOLOGY"
  | "CULTURE";

export interface RoomCategoryOption {
  value: RoomCategory;
  label: string;
}

export const ROOM_CATEGORY_OPTIONS: readonly RoomCategoryOption[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "SCIENCE", label: "Khoa học" },
  { value: "HISTORY", label: "Lịch sử" },
  { value: "TECHNOLOGY", label: "Công nghệ" },
  { value: "CULTURE", label: "Văn hóa" },
] as const;

// Room Code Alphabet (excluding ambiguous chars: 0, O, I, 1, l)
export const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Generate Room Code (Strategy Pattern - can be swapped)
export function generateRoomCode(
  length = GAME_CONFIG.ROOM_CODE_LENGTH,
): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[randomIndex];
  }
  return code;
}

// Error Codes
export { ErrorCode } from "./error-codes";
import { ErrorCode } from "./error-codes";

// Error Messages (Vietnamese)
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.ROOM_NOT_FOUND]: "Không tìm thấy phòng",
  [ErrorCode.ROOM_FULL]: "Phòng đã đầy",
  [ErrorCode.ROOM_ALREADY_STARTED]: "Trận đấu đã bắt đầu",
  [ErrorCode.PLAYER_NOT_IN_ROOM]: "Bạn không ở trong phòng này",
  [ErrorCode.MATCH_NOT_FOUND]: "Không tìm thấy trận đấu",
  [ErrorCode.MATCH_ALREADY_STARTED]: "Trận đấu đã bắt đầu",
  [ErrorCode.ROUND_NOT_ACTIVE]: "Câu hỏi không còn hoạt động",
  [ErrorCode.ALREADY_ANSWERED]: "Bạn đã trả lời rồi",
  [ErrorCode.ANSWER_SUBMISSION_CLOSED]: "Hết thời gian trả lời",
  [ErrorCode.UNAUTHORIZED]: "Chưa xác thực",
  [ErrorCode.INVALID_TOKEN]: "Token không hợp lệ",
  [ErrorCode.RATE_LIMITED]: "Quá nhiều yêu cầu, vui lòng thử lại sau",
  [ErrorCode.INTERNAL_ERROR]: "Lỗi hệ thống",
  [ErrorCode.NOT_ROOM_HOST]: "Chỉ chủ phòng mới có thể bắt đầu",
  [ErrorCode.NOT_ENOUGH_PLAYERS]: "Cần ít nhất 2 người chơi",
};
