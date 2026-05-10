export declare enum RoomEventType {
    ROOM_CREATED = "ROOM_CREATED",
    PLAYER_JOINED = "PLAYER_JOINED",
    PLAYER_LEFT = "PLAYER_LEFT",
    ROOM_SETTINGS_UPDATED = "ROOM_SETTINGS_UPDATED",
    MATCH_STARTED = "MATCH_STARTED"
}
export declare enum MatchEventType {
    MATCH_CREATED = "MATCH_CREATED",
    MATCH_STARTED = "MATCH_STARTED",
    ROUND_STARTED = "ROUND_STARTED",
    ROUND_ENDED = "ROUND_ENDED",
    ANSWER_SUBMITTED = "ANSWER_SUBMITTED",
    PLAYER_ELIMINATED = "PLAYER_ELIMINATED",
    MATCH_FINISHED = "MATCH_FINISHED",
    PLAYER_RECONNECTED = "PLAYER_RECONNECTED",
    PLAYER_DISCONNECTED = "PLAYER_DISCONNECTED"
}
export interface BaseEvent<T = unknown> {
    id: string;
    type: string;
    timestamp: number;
    payload: T;
    seqNo: number;
}
export interface RoomCreatedPayload {
    roomId: string;
    roomCode: string;
    hostId: string;
    roomType: 'PUBLIC' | 'PRIVATE';
    maxPlayers: number;
}
export interface PlayerJoinedPayload {
    roomId: string;
    playerId: string;
    playerName: string;
    joinedAt: number;
}
export interface PlayerLeftPayload {
    roomId: string;
    playerId: string;
    reason: 'DISCONNECTED' | 'KICKED' | 'LEFT';
}
export interface MatchCreatedPayload {
    matchId: string;
    roomId: string;
    playerIds: string[];
}
export interface RoundStartedPayload {
    matchId: string;
    roundNo: number;
    question: QuestionSnapshot;
    startedAt: number;
    endsAt: number;
}
export interface RoundEndedPayload {
    matchId: string;
    roundNo: number;
    correctAnswer: string;
    survivingPlayerIds: string[];
    eliminatedPlayerIds: string[];
}
export interface AnswerSubmittedPayload {
    matchId: string;
    roundNo: number;
    playerId: string;
    answer: string;
    isCorrect: boolean;
    responseTimeMs: number;
    submittedAt: number;
}
export interface PlayerEliminatedPayload {
    matchId: string;
    roundNo: number;
    playerId: string;
    reason: 'WRONG_ANSWER' | 'TIMEOUT';
}
export interface MatchFinishedPayload {
    matchId: string;
    winnerId: string;
    totalRounds: number;
    finishedAt: number;
}
export interface PlayerReconnectedPayload {
    matchId: string;
    playerId: string;
    lastSeenSeqNo: number;
    reconnectedAt: number;
}
export interface QuestionSnapshot {
    id: string;
    content: string;
    options: string[];
}
export type RoomEvent = BaseEvent<RoomCreatedPayload> | BaseEvent<PlayerJoinedPayload> | BaseEvent<PlayerLeftPayload>;
export type MatchEvent = BaseEvent<MatchCreatedPayload> | BaseEvent<MatchStartedPayload> | BaseEvent<RoundStartedPayload> | BaseEvent<RoundEndedPayload> | BaseEvent<AnswerSubmittedPayload> | BaseEvent<PlayerEliminatedPayload> | BaseEvent<MatchFinishedPayload> | BaseEvent<PlayerReconnectedPayload>;
export declare function createEvent<T>(type: string, payload: T, seqNo: number): BaseEvent<T>;
//# sourceMappingURL=events.d.ts.map