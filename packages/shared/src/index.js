"use strict";
// ============================================================
// @arena/shared - Main Entry Point
// Game Đấu Trường 100 - Shared Types & Constants
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_MESSAGES = exports.ErrorCode = exports.ROOM_CODE_CHARS = exports.GAME_CONFIG = void 0;
exports.generateRoomCode = generateRoomCode;
// Events
__exportStar(require("./events"), exports);
// State Types
__exportStar(require("./state"), exports);
// Socket Protocol
__exportStar(require("./socket"), exports);
// Game Constants
exports.GAME_CONFIG = {
    MAX_PLAYERS: 100,
    MIN_PLAYERS_TO_START: 2,
    ROUND_DURATION_MS: 15_000, // 15 seconds per round
    COUNTDOWN_DURATION_MS: 5_000, // 5 seconds countdown
    RESULT_DISPLAY_MS: 3_000, // 3 seconds to show result
    MAX_ROUNDS: 50, // Safety limit
    ROOM_CODE_LENGTH: 6,
};
// Room Code Alphabet (excluding ambiguous chars: 0, O, I, 1, l)
exports.ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Generate Room Code (Strategy Pattern - can be swapped)
function generateRoomCode(length = exports.GAME_CONFIG.ROOM_CODE_LENGTH) {
    let code = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * exports.ROOM_CODE_CHARS.length);
        code += exports.ROOM_CODE_CHARS[randomIndex];
    }
    return code;
}
// Error Codes
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["ROOM_NOT_FOUND"] = "ROOM_NOT_FOUND";
    ErrorCode["ROOM_FULL"] = "ROOM_FULL";
    ErrorCode["ROOM_ALREADY_STARTED"] = "ROOM_ALREADY_STARTED";
    ErrorCode["PLAYER_NOT_IN_ROOM"] = "PLAYER_NOT_IN_ROOM";
    ErrorCode["MATCH_NOT_FOUND"] = "MATCH_NOT_FOUND";
    ErrorCode["MATCH_ALREADY_STARTED"] = "MATCH_ALREADY_STARTED";
    ErrorCode["ROUND_NOT_ACTIVE"] = "ROUND_NOT_ACTIVE";
    ErrorCode["ALREADY_ANSWERED"] = "ALREADY_ANSWERED";
    ErrorCode["ANSWER_SUBMISSION_CLOSED"] = "ANSWER_SUBMISSION_CLOSED";
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["INVALID_TOKEN"] = "INVALID_TOKEN";
    ErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
// Error Messages (Vietnamese)
exports.ERROR_MESSAGES = {
    [ErrorCode.ROOM_NOT_FOUND]: 'Không tìm thấy phòng',
    [ErrorCode.ROOM_FULL]: 'Phòng đã đầy',
    [ErrorCode.ROOM_ALREADY_STARTED]: 'Trận đấu đã bắt đầu',
    [ErrorCode.PLAYER_NOT_IN_ROOM]: 'Bạn không ở trong phòng này',
    [ErrorCode.MATCH_NOT_FOUND]: 'Không tìm thấy trận đấu',
    [ErrorCode.MATCH_ALREADY_STARTED]: 'Trận đấu đã bắt đầu',
    [ErrorCode.ROUND_NOT_ACTIVE]: 'Câu hỏi không còn hoạt động',
    [ErrorCode.ALREADY_ANSWERED]: 'Bạn đã trả lời rồi',
    [ErrorCode.ANSWER_SUBMISSION_CLOSED]: 'Hết thời gian trả lời',
    [ErrorCode.UNAUTHORIZED]: 'Chưa xác thực',
    [ErrorCode.INVALID_TOKEN]: 'Token không hợp lệ',
    [ErrorCode.RATE_LIMITED]: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
    [ErrorCode.INTERNAL_ERROR]: 'Lỗi hệ thống',
};
//# sourceMappingURL=index.js.map