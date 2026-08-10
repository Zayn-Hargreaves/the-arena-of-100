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

// Game Constants (defined in its own file so schemas.ts can
// import GAME_CONFIG.MAX_ROUNDS without creating a circular
// dependency through the index barrel).
export { GAME_CONFIG } from "./game-config";
// Daily Challenge Constants (own file for the same reason as
// game-config: the API's Zod DTOs import it directly).
export { DAILY_QUESTION_COUNT } from "./daily-config";
import { GAME_CONFIG } from "./game-config";

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
  { value: "ALL", label: "All" },
  { value: "SCIENCE", label: "Science" },
  { value: "HISTORY", label: "History" },
  { value: "TECHNOLOGY", label: "Technology" },
  { value: "CULTURE", label: "Culture" },
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
  [ErrorCode.INVALID_ROOM_TYPE]: "Loại phòng không hợp lệ",
  [ErrorCode.SPECTATOR_CANNOT_ANSWER]: "Khán giả không thể gửi câu trả lời",
  [ErrorCode.INVALID_PAYLOAD]: "Dữ liệu gửi lên không hợp lệ",
  [ErrorCode.PLAYER_DISCONNECTED]: "Bạn đã bị ngắt kết nối, vui lòng thử lại",
  [ErrorCode.COMMAND_ID_CONFLICT]:
    "commandId đã được sử dụng với một lệnh khác",
  [ErrorCode.AOE_CAP_EXHAUSTED]: "Đã đạt giới hạn AOE của round này",
  [ErrorCode.CARD_NOT_IN_HAND]: "Lá bài không có trong tay",
  [ErrorCode.CARD_NOT_FOUND]: "Không tìm thấy lá bài",
  [ErrorCode.INVALID_COMMAND_ID]: "commandId không hợp lệ",
};
