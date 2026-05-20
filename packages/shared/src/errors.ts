// ============================================================
// Custom Error Classes - Game Đấu Trường 100
// ============================================================

import { ErrorCode } from "./error-codes";

export class RoomError extends Error {
  public code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message || code);
    this.code = code;
    this.name = "RoomError";
  }
}
