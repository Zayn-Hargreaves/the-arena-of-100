export enum ErrorCode {
  ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
  ROOM_FULL = "ROOM_FULL",
  ROOM_ALREADY_STARTED = "ROOM_ALREADY_STARTED",
  PLAYER_NOT_IN_ROOM = "PLAYER_NOT_IN_ROOM",
  MATCH_NOT_FOUND = "MATCH_NOT_FOUND",
  MATCH_ALREADY_STARTED = "MATCH_ALREADY_STARTED",
  ROUND_NOT_ACTIVE = "ROUND_NOT_ACTIVE",
  ALREADY_ANSWERED = "ALREADY_ANSWERED",
  ANSWER_SUBMISSION_CLOSED = "ANSWER_SUBMISSION_CLOSED",
  NOT_ROOM_HOST = "NOT_ROOM_HOST",
  NOT_ENOUGH_PLAYERS = "NOT_ENOUGH_PLAYERS",
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_TOKEN = "INVALID_TOKEN",
  RATE_LIMITED = "RATE_LIMITED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  INVALID_ROOM_TYPE = "INVALID_ROOM_TYPE",
  // Drop-in spectating baseline (PR): emitted when a user that is not
  // a registered player in the match tries to submit an answer.
  // Server-side gate in MatchHandler.handleSubmitAnswer.
  SPECTATOR_CANNOT_ANSWER = "SPECTATOR_CANNOT_ANSWER",
  // C2 fix: emitted by the WebSocket validation pipe when a client
  // event payload fails its Zod schema (wrong type, missing field,
  // oversized string, object injection in a string field, ...).
  // The pipe runs before any handler code, so the malformed payload
  // never reaches the business logic.
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
  // M6 fix: a player who has been marked DISCONNECTED in the state
  // machine (e.g. via socket disconnect or a voluntary LEAVE_ROOM
  // during IN_GAME) tries to submit an answer. The old generic
  // "PLAYER_NOT_IN_ROOM" message was misleading because the user
  // was, in fact, in the room moments earlier. The frontend can
  // use this distinct code to show "Bạn đã bị ngắt kết nối" and
  // trigger a reconnect flow.
  PLAYER_DISCONNECTED = "PLAYER_DISCONNECTED",
}
