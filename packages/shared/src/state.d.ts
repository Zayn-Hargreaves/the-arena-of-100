export declare enum RoomStatus {
    WAITING = "WAITING",
    COUNTDOWN = "COUNTDOWN",
    IN_GAME = "IN_GAME",
    FINISHED = "FINISHED"
}
export declare enum MatchStatus {
    CREATED = "CREATED",
    COUNTDOWN = "COUNTDOWN",
    ROUND_ACTIVE = "ROUND_ACTIVE",
    ROUND_EVALUATING = "ROUND_EVALUATING",
    ROUND_RESULT = "ROUND_RESULT",
    FINISHED = "FINISHED"
}
export declare enum PlayerStatus {
    ACTIVE = "ACTIVE",
    ELIMINATED = "ELIMINATED",
    DISCONNECTED = "DISCONNECTED",
    WINNER = "WINNER"
}
export interface RoomState {
    id: string;
    code: string;
    status: RoomStatus;
    hostId: string;
    roomType: 'PUBLIC' | 'PRIVATE';
    maxPlayers: number;
    currentPlayers: PlayerInfo[];
    currentMatchId: string | null;
    createdAt: number;
}
export interface PlayerInfo {
    id: string;
    name: string;
    status: PlayerStatus;
    score: number;
    totalResponseTimeMs: number;
    correctAnswers: number;
    isOnline: boolean;
}
export interface MatchState {
    id: string;
    roomId: string;
    status: MatchStatus;
    currentRoundNo: number;
    totalRounds: number;
    players: Map<string, PlayerInfo>;
    survivingPlayerIds: string[];
    eliminatedPlayerIds: string[];
    winnerId: string | null;
    startedAt: number;
    endedAt: number | null;
}
export interface RoundState {
    matchId: string;
    roundNo: number;
    question: QuestionState;
    startedAt: number;
    endsAt: number;
    answers: Map<string, AnswerState>;
    status: 'PENDING' | 'ACTIVE' | 'EVALUATING' | 'COMPLETED';
}
export interface QuestionState {
    id: string;
    content: string;
    options: string[];
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
}
export interface AnswerState {
    playerId: string;
    answer: string;
    isCorrect: boolean;
    responseTimeMs: number;
    submittedAt: number;
}
export interface MatchSnapshot {
    matchId: string;
    status: MatchStatus;
    currentRoundNo: number;
    players: PlayerInfo[];
    currentQuestion: QuestionState | null;
    roundEndTime: number | null;
    lastEventSeqNo: number;
}
export interface TieBreakResult {
    winnerId: string;
    tiedPlayerIds: string[];
    tieBreakReason: 'TOTAL_RESPONSE_TIME' | 'EARLIEST_CORRECT' | 'RANDOM';
    details: {
        totalResponseTimeMs: Map<string, number>;
        earliestCorrectRound: Map<string, number>;
    };
}
//# sourceMappingURL=state.d.ts.map