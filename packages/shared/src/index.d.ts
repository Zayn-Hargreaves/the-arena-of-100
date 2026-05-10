export * from './events';
export * from './state';
export * from './socket';
export declare const GAME_CONFIG: {
    readonly MAX_PLAYERS: 100;
    readonly MIN_PLAYERS_TO_START: 2;
    readonly ROUND_DURATION_MS: 15000;
    readonly COUNTDOWN_DURATION_MS: 5000;
    readonly RESULT_DISPLAY_MS: 3000;
    readonly MAX_ROUNDS: 50;
    readonly ROOM_CODE_LENGTH: 6;
};
export declare const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export declare function generateRoomCode(length?: 6): string;
export declare enum ErrorCode {
    ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
    ROOM_FULL = "ROOM_FULL",
    ROOM_ALREADY_STARTED = "ROOM_ALREADY_STARTED",
    PLAYER_NOT_IN_ROOM = "PLAYER_NOT_IN_ROOM",
    MATCH_NOT_FOUND = "MATCH_NOT_FOUND",
    MATCH_ALREADY_STARTED = "MATCH_ALREADY_STARTED",
    ROUND_NOT_ACTIVE = "ROUND_NOT_ACTIVE",
    ALREADY_ANSWERED = "ALREADY_ANSWERED",
    ANSWER_SUBMISSION_CLOSED = "ANSWER_SUBMISSION_CLOSED",
    UNAUTHORIZED = "UNAUTHORIZED",
    INVALID_TOKEN = "INVALID_TOKEN",
    RATE_LIMITED = "RATE_LIMITED",
    INTERNAL_ERROR = "INTERNAL_ERROR"
}
export declare const ERROR_MESSAGES: Record<ErrorCode, string>;
//# sourceMappingURL=index.d.ts.map