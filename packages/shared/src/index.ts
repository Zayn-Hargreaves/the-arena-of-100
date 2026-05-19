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

// Game Constants
export const GAME_CONFIG = {
  MAX_PLAYERS: 100,
  MIN_PLAYERS_TO_START: 2,
  ROUND_DURATION_MS: 15_000, // 15 seconds per round
  COUNTDOWN_DURATION_MS: 5_000, // 5 seconds countdown
  RESULT_DISPLAY_MS: 3_000, // 3 seconds to show result
  MAX_ROUNDS: 50, // Safety limit
  ROOM_CODE_LENGTH: 6,
} as const;

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
