export declare enum SocketNamespace {
  ROOM = "room",
  MATCH = "match",
}
export declare enum ClientEvent {
  JOIN_ROOM = "join_room",
  LEAVE_ROOM = "leave_room",
  CREATE_ROOM = "create_room",
  START_MATCH = "start_match",
  SUBMIT_ANSWER = "submit_answer",
  REQUEST_SNAPSHOT = "request_snapshot",
  AUTHENTICATE = "authenticate",
  PING = "ping",
}
export declare enum ServerEvent {
  ROOM_CREATED = "room_created",
  PLAYER_JOINED = "player_joined",
  PLAYER_LEFT = "player_left",
  MATCH_STARTING = "match_starting",
  MATCH_STARTED = "match_started",
  ROUND_STARTED = "round_started",
  ROUND_ENDED = "round_ended",
  ANSWER_RESULT = "answer_result",
  PLAYER_ELIMINATED = "player_eliminated",
  MATCH_FINISHED = "match_finished",
  SNAPSHOT = "snapshot",
  EVENT_BATCH = "event_batch",
  AUTHENTICATED = "authenticated",
  ERROR = "error",
  PONG = "pong",
  KICKED = "kicked",
}
export interface JoinRoomPayload {
  roomCode?: string;
  roomType?: "PUBLIC" | "PRIVATE";
}
export interface LeaveRoomPayload {
  roomId: string;
}
export interface CreateRoomPayload {
  roomType: "PUBLIC" | "PRIVATE";
  maxPlayers?: number;
}
export interface StartMatchPayload {
  roomId: string;
}
export interface SubmitAnswerPayload {
  matchId: string;
  roundNo: number;
  answer: string;
  clientTimestamp: number;
}
export interface RequestSnapshotPayload {
  matchId: string;
  lastSeenSeqNo: number;
}
export interface AuthenticatePayload {
  token: string;
}
export interface ErrorPayload {
  code: string;
  message: string;
}
export interface SnapshotPayload {
  matchId: string;
  status: string;
  currentRoundNo: number;
  players: Array<{
    id: string;
    name: string;
    status: string;
    score: number;
  }>;
  currentQuestion: {
    id: string;
    content: string;
    options: string[];
  } | null;
  roundEndTime: number | null;
  lastEventSeqNo: number;
}
export interface EventBatchPayload {
  events: Array<{
    id: string;
    type: string;
    timestamp: number;
    payload: unknown;
    seqNo: number;
  }>;
}
export interface AnswerResultPayload {
  matchId: string;
  roundNo: number;
  isCorrect: boolean;
  responseTimeMs: number;
  correctAnswer?: string;
}
export declare function getRoomChannel(roomId: string): string;
export declare function getMatchChannel(matchId: string): string;
export declare function getPlayerChannel(playerId: string): string;
//# sourceMappingURL=socket.d.ts.map
