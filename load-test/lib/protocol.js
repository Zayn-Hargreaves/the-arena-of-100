// ============================================================
// Wire protocol constants — mirrored from packages/shared/src/socket.ts.
//
// k6 runs plain JS and cannot import the TS @arena/shared barrel, so
// the event-name strings are duplicated here. They MUST stay in sync
// with ClientEvent / ServerEvent in packages/shared/src/socket.ts.
// (If a smoke run starts failing at a specific step, check drift here
// first.)
// ============================================================

export const ClientEvent = {
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  CREATE_ROOM: "create_room",
  START_MATCH: "start_match",
  SUBMIT_ANSWER: "submit_answer",
  REQUEST_SNAPSHOT: "request_snapshot",
  AUTHENTICATE: "authenticate",
  HEARTBEAT: "heartbeat",
  PING: "ping",
};

export const ServerEvent = {
  // Room
  ROOM_CREATED: "room_created",
  ROOM_JOINED: "room_joined",
  PLAYER_JOINED: "player_joined",
  PLAYER_LEFT: "player_left",
  ROOM_STATUS_UPDATED: "room_status_updated",
  ROOM_COUNTDOWN_STARTED: "room_countdown_started",
  ROOM_COUNTDOWN_CANCELLED: "room_countdown_cancelled",
  ROOM_PRESENCE_UPDATED: "room_presence_updated",
  MATCH_STARTING: "match_starting",
  // Match
  MATCH_STARTED: "match_started",
  ROUND_STARTED: "round_started",
  ROUND_ENDED: "round_ended",
  ANSWER_RESULT: "answer_result",
  PLAYER_ELIMINATED: "player_eliminated",
  MATCH_FINISHED: "match_finished",
  // Sync
  SNAPSHOT: "snapshot",
  EVENT_BATCH: "event_batch",
  // Connection
  AUTHENTICATED: "authenticated",
  ERROR: "error",
  PONG: "pong",
  KICKED: "kicked",
};

// The socket.io server namespace the gateway registers
// (@WebSocketGateway({ namespace: "/game" })).
export const NAMESPACE = "/game";
