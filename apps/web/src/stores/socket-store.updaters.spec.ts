import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type SnapshotPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type JoinMode,
  type RoomType,
  type CardId,
  type ClassId,
  type CardEffectEvent,
} from "@arena/shared";
import { describe, expect, it } from "vitest";
import {
  applyAnswerResultState,
  applyAuthenticatedState,
  applyEventBatchState,
  applyMatchFinishedState,
  applyMatchStartedState,
  applyMatchStartingState,
  applyPlayerEliminatedState,
  applyPlayerJoinedState,
  applyPlayerLeftState,
  applyRoomCountdownCancelledState,
  applyRoomCountdownStartedState,
  applyRoomCreatedState,
  applyRoomJoinedState,
  applyRoomPresenceUpdatedState,
  applyRoomStatusUpdatedState,
  applyRoomTerminatedState,
  applyRoundEndedState,
  applyRoundStartedState,
  applySnapshotState,
  applyUnauthorizedErrorState,
  applyTopicVotingStartedState,
  applyTopicVotingSummaryState,
  applyTopicVotingFinishedState,
  applyMatchmakingStatusState,
  applyMatchmakingMatchedState,
  applyClassAssignedState,
  applyCardOfferState,
  applyCardPickedState,
  applyCardResolvedState,
} from "./socket-store.updaters";

import {
  INITIAL_CARD_STATE,
  type Match,
  type Room,
  type SocketState,
} from "./socket-store.types";
import type { EventBatchPayload } from "@arena/shared";

const basePlayers = [
  {
    id: "p1",
    name: "Alice",
    status: PlayerStatus.ACTIVE,
    score: 0,
    isOnline: true,
  },
  {
    id: "p2",
    name: "Bob",
    status: PlayerStatus.ACTIVE,
    score: 0,
    isOnline: true,
  },
];

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    status: MatchStatus.ROUND_ACTIVE,
    currentRoundNo: 1,
    players: basePlayers,
    currentQuestion: null,
    roundEndTime: null,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "r1",
    code: "ABC",
    status: RoomStatus.IN_GAME,
    hostId: "p1",
    roomType: "PUBLIC" satisfies RoomType,
    currentMatchId: "m1",
    countdownEndsAt: null,
    players: basePlayers,
    joinMode: "PLAYER" satisfies JoinMode,
    maxPlayers: 100,
    ...overrides,
  };
}

type BatchEvent = {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
  seqNo: number;
};

function makeBatch(events: BatchEvent[], matchId = "m1"): EventBatchPayload {
  return { matchId, events };
}

function makeState(overrides: Partial<SocketState> = {}): SocketState {
  return {
    isConnected: true,
    isAuthenticated: true,
    userId: "p1",
    username: "Alice",
    accessToken: "t",
    userRole: "GUEST",
    socket: null,
    room: null,
    match: null,
    topicVoting: null,
    matchmaking: {
      isQueued: false,
      queuedAt: null,
      elapsedSeconds: 0,
      estimatedWaitSeconds: 0,
      playersInQueue: 0,
      matchedRoomCode: null,
      matchedRoomId: null,
      matchedMatchId: null,
    },
    cardState: INITIAL_CARD_STATE,
    lastAnswerResult: null,
    pendingAnswer: null,
    remainingCount: null,
    lastSeenSeqNo: 0,
    error: null,
    heartbeatInterval: null,
    isEliminated: false,
    eliminationReason: null,
    roomTerminated: false,
    roomTerminationMessage: null,
    connect: () => Promise.resolve(),
    disconnect: () => {},
    authenticate: () => Promise.resolve(),
    refreshAccessToken: () => Promise.resolve(null),
    createRoom: () => Promise.resolve("ROOM"),
    joinRoom: () => Promise.resolve(),
    leaveRoom: () => {},
    startMatch: () => {},
    joinMatchmaking: () => {},
    leaveMatchmaking: () => {},
    clearMatchmakingMatched: () => {},
    voteBanTopic: () => {},
    pickCard: () => {},
    playCard: () => {},
    dismissCardOffer: () => {},
    submitAnswer: () => null,
    requestSnapshot: () => {},
    ...overrides,
  };
}

describe("applyRoundEndedState — stale state.match guard", () => {
  it("builds a fresh match when state.match.id is stale but currentMatchId matches", () => {
    // Active match id lives on room.currentMatchId; state.match still
    // references the previous match. The event belongs to the new
    // match (m-new), so the updater must NOT spread the stale
    // state.match and must build a fresh one from data.matchId +
    // room.players.
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m-new",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
      match: {
        id: "m-old",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 3,
        players: [
          {
            id: "stale",
            name: "Stale",
            status: PlayerStatus.ELIMINATED,
            score: 99,
            isOnline: false,
          },
        ],
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyRoundEndedState(
      state,
      {
        matchId: "m-new",
        roundNo: 1,
        correctAnswer: "A",
        survivingPlayerIds: ["p1", "p2"],
        eliminatedPlayerIds: [],
      },
      null,
    );

    expect(result.match?.id).toBe("m-new");
    expect(result.match?.players).toEqual(basePlayers);
    expect(result.match?.status).toBe(MatchStatus.ROUND_RESULT);
    // Defensive: the stale match id/roster must NOT bleed through.
    expect(result.match?.players.find((p) => p.id === "stale")).toBeUndefined();
  });

  it("spreads state.match when its id matches the event", () => {
    const state = makeState({
      match: {
        id: "m1",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: basePlayers,
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyRoundEndedState(
      state,
      {
        matchId: "m1",
        roundNo: 1,
        correctAnswer: "A",
        survivingPlayerIds: ["p1", "p2"],
        eliminatedPlayerIds: ["p1"],
      },
      null,
    );

    expect(result.match?.id).toBe("m1");
    expect(result.match?.players.find((p) => p.id === "p1")?.status).toBe(
      PlayerStatus.ELIMINATED,
    );
  });
});

describe("applyRoundStartedState — stale state.match guard", () => {
  it("builds a fresh match when state.match.id is stale but currentMatchId matches", () => {
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m-new",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
      match: {
        id: "m-old",
        status: MatchStatus.ROUND_RESULT,
        currentRoundNo: 7,
        players: [
          {
            id: "stale",
            name: "Stale",
            status: PlayerStatus.ELIMINATED,
            score: 99,
            isOnline: false,
          },
        ],
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyRoundStartedState(state, {
      matchId: "m-new",
      roundNo: 2,
      question: {
        id: "q1",
        content: "Question?",
        options: ["A", "B", "C", "D"],
      },
      startedAt: 1,
      endsAt: 2,
    });

    expect(result.match?.id).toBe("m-new");
    expect(result.match?.players).toEqual(basePlayers);
    expect(result.match?.status).toBe(MatchStatus.ROUND_ACTIVE);
    expect(result.lastAnswerResult).toBeNull();
  });

  it("returns no-op when the event does not match the active match", () => {
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m-old",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
    });

    const result = applyRoundStartedState(state, {
      matchId: "m-new",
      roundNo: 2,
      question: {
        id: "q1",
        content: "Question?",
        options: ["A", "B", "C", "D"],
      },
      startedAt: 1,
      endsAt: 2,
    });

    expect(result).toEqual({});
  });
});

describe("applyMatchFinishedState — stale state.match guard", () => {
  it("returns match.id = data.matchId when state.match is stale", () => {
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m-new",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
      match: {
        id: "m-old",
        status: MatchStatus.ROUND_RESULT,
        currentRoundNo: 7,
        players: [
          {
            id: "stale",
            name: "Stale",
            status: PlayerStatus.ELIMINATED,
            score: 99,
            isOnline: false,
          },
        ],
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyMatchFinishedState(state, {
      matchId: "m-new",
      winnerId: "p1",
      totalRounds: 3,
      finishedAt: 1,
    });

    expect(result.match?.id).toBe("m-new");
    expect(result.match?.status).toBe(MatchStatus.FINISHED);
    // No stale roster carried over.
    expect(result.match?.players.find((p) => p.id === "stale")).toBeUndefined();
    expect(result.match?.players).toEqual(basePlayers);
  });

  it("spreads state.match when its id matches the event", () => {
    const state = makeState({
      match: {
        id: "m1",
        status: MatchStatus.ROUND_RESULT,
        currentRoundNo: 3,
        players: basePlayers,
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyMatchFinishedState(state, {
      matchId: "m1",
      winnerId: "p1",
      totalRounds: 3,
      finishedAt: 1,
    });

    expect(result.match?.id).toBe("m1");
    expect(result.match?.status).toBe(MatchStatus.FINISHED);
  });

  it("returns no-op when activeMatchId does not match the event", () => {
    const state = makeState({
      match: {
        id: "m-old",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: basePlayers,
        currentQuestion: null,
        roundEndTime: null,
      },
    });

    const result = applyMatchFinishedState(state, {
      matchId: "m-new",
      winnerId: "p1",
      totalRounds: 1,
      finishedAt: 1,
    });

    expect(result).toEqual({});
  });
});

describe("applyAnswerResultState", () => {
  it("updates lastAnswerResult only for the matching pending answer", () => {
    const state = makeState({
      pendingAnswer: {
        matchId: "m1",
        roundNo: 2,
        answer: "A",
        submissionId: "s1",
      },
    });

    const result = applyAnswerResultState(state, {
      matchId: "m1",
      roundNo: 2,
      submissionId: "s1",
      isCorrect: true,
      responseTimeMs: 123,
    });

    expect(result.lastAnswerResult).toMatchObject({ submissionId: "s1" });
    expect(result.pendingAnswer).toBeNull();
  });

  it("keeps pending answer while storing a mismatched answer result", () => {
    const pendingAnswer = {
      matchId: "m1",
      roundNo: 2,
      answer: "A",
      submissionId: "s1",
    };
    const state = makeState({ pendingAnswer });

    const result = applyAnswerResultState(state, {
      matchId: "m1",
      roundNo: 2,
      submissionId: "stale",
      isCorrect: false,
      responseTimeMs: 999,
    });

    expect(result.lastAnswerResult).toMatchObject({ submissionId: "stale" });
    expect(result.pendingAnswer).toBe(pendingAnswer);
  });

  it("stores answer result when pending answer is already clear", () => {
    const result = applyAnswerResultState(makeState(), {
      matchId: "m1",
      roundNo: 2,
      submissionId: "s1",
      isCorrect: true,
      responseTimeMs: 123,
    });

    expect(result.lastAnswerResult).toMatchObject({ submissionId: "s1" });
    expect(result.pendingAnswer).toBeNull();
  });
});

describe("applyUnauthorizedErrorState", () => {
  it("clears prior room termination state along with auth state", () => {
    const result = applyUnauthorizedErrorState("nope", makeState());

    expect(result).toMatchObject({
      socket: null,
      isConnected: false,
      isAuthenticated: false,
      accessToken: null,
      userRole: null,
      userId: null,
      username: null,
      room: null,
      match: null,
      remainingCount: null,
      lastAnswerResult: null,
      pendingAnswer: null,
      isEliminated: false,
      heartbeatInterval: null,
      roomTerminated: false,
      roomTerminationMessage: null,
      error: "nope",
    });
  });

  it("resets eliminationReason to null alongside isEliminated", () => {
    const state = makeState({
      isEliminated: true,
      eliminationReason: "TIMEOUT",
    });

    const result = applyUnauthorizedErrorState("nope", state);

    expect(result.isEliminated).toBe(false);
    expect(result.eliminationReason).toBeNull();
    // sanity: the pre-state was actually eliminated
    expect(state.eliminationReason).toBe("TIMEOUT");
  });
});

describe("applySnapshotState — reconnect-after-elimination hydrate", () => {
  const snapshot = (
    players: Array<{ id: string; status: PlayerStatus }>,
  ): SnapshotPayload => ({
    matchId: "m1",
    status: MatchStatus.ROUND_ACTIVE,
    currentRoundNo: 4,
    players: players.map((p) => ({
      id: p.id,
      name: p.id,
      status: p.status,
      score: 0,
      isOnline: true,
    })),
    currentQuestion: null,
    roundEndTime: null,
    lastEventSeqNo: 10,
  });

  it("hydrates isEliminated=true when the local player is ELIMINATED in the snapshot roster", () => {
    // userId is "p1" in makeState.
    const state = makeState({ isEliminated: false });
    const result = applySnapshotState(
      state,
      snapshot([
        { id: "p1", status: PlayerStatus.ELIMINATED },
        { id: "p2", status: PlayerStatus.ACTIVE },
      ]),
    );

    expect(result.isEliminated).toBe(true);
  });

  it("keeps isEliminated=false when the local player is still ACTIVE", () => {
    const state = makeState({ isEliminated: false });
    const result = applySnapshotState(
      state,
      snapshot([
        { id: "p1", status: PlayerStatus.ACTIVE },
        { id: "p2", status: PlayerStatus.ELIMINATED },
      ]),
    );

    expect(result.isEliminated).toBe(false);
  });

  it("clears a stale isEliminated=true when the snapshot shows the local player ACTIVE", () => {
    // Defends the reconnect path: a leftover elimination flag from a
    // previous match must not survive a snapshot that says we are alive.
    // Same for `eliminationReason`: snapshot hydrate resets to null
    // (snapshot carries no reason per applySnapshotState contract).
    const state = makeState({
      isEliminated: true,
      eliminationReason: "TIMEOUT",
    });
    const result = applySnapshotState(
      state,
      snapshot([{ id: "p1", status: PlayerStatus.ACTIVE }]),
    );

    expect(result.isEliminated).toBe(false);
    expect(result.eliminationReason).toBeNull();
  });

  it("sets the delta cursor from the snapshot lastEventSeqNo", () => {
    const state = makeState({ lastSeenSeqNo: 0 });
    const result = applySnapshotState(
      state,
      snapshot([{ id: "p1", status: PlayerStatus.ACTIVE }]),
    );

    expect(result.lastSeenSeqNo).toBe(10);
  });
});

// Plan D — delta replay: pin the contract of `applyEventBatchState`
// (socket-store.updaters.ts:513-595) against Plan D1 acceptance
// (Plan-D1-contract-design.md §6b, §7). Groups A–G cover the match
// guards, replayable event reducers, no-op events, idempotent cursor
// advance, the no-touch invariant on score/isOnline, and the
// self-eliminated recompute.
describe("applyEventBatchState — Plan D delta replay", () => {
  // ----- Group A — Match guard (Plan D1 §6b) -----

  it("returns no-op when state has no match and no room (activeMatchId null)", () => {
    // Both state.room and state.match are absent: the active match id
    // resolves to null, so the guard must reject the batch without
    // mutating state.
    const state = makeState();
    const result = applyEventBatchState(state, makeBatch([]));

    expect(result).toEqual({});
  });

  it("returns no-op when activeMatchId differs from batch matchId (stale broadcast)", () => {
    const state = makeState({ match: makeMatch() });
    const result = applyEventBatchState(state, makeBatch([], "m-other"));

    expect(result).toEqual({});
  });

  it("returns no-op when state.match.id does not match the envelope (no base to fold onto)", () => {
    // A delta applies onto a live match for the same id. If the
    // client has no base match for the envelope's matchId, the
    // reducer cannot rebuild the question/timer — the caller must
    // full-hydrate first. No fold attempted.
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m1",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
      // state.match intentionally null: no live match to fold onto
      match: null,
    });
    const result = applyEventBatchState(state, makeBatch([]));

    expect(result).toEqual({});
  });

  // ----- Group B — Empty events branch (Plan D1 §7) -----

  it("empty events branch: cursor unchanged and match reference is preserved", () => {
    // Plan D1 §7: "Nếu events rỗng: chỉ validate lastEventSeqNo === currentLastSeenSeqNo.
    // Pass ⇒ cập nhật lastSeenSeqNo = envelope.lastEventSeqNo và return." The
    // wire does not carry a top-level lastEventSeqNo on the batch today,
    // so cursor must remain at the store value (no event to advance it).
    // The match reference is also preserved (shallow equal) — empty
    // batches must not allocate a new match object.
    const match = makeMatch({ currentRoundNo: 5 });
    const state = makeState({ match, lastSeenSeqNo: 10 });

    const result = applyEventBatchState(state, makeBatch([]));

    expect(result.lastSeenSeqNo).toBe(10);
    expect(result.match).toBe(match);
  });

  // ----- Group C — Replayable event reducers (Plan D1 §6b) -----

  it("STATE_TRANSITION: updates match.status from payload.to, other fields untouched", () => {
    const state = makeState({
      match: makeMatch({ status: MatchStatus.CREATED, currentRoundNo: 0 }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "STATE_TRANSITION",
          timestamp: 1,
          payload: { from: MatchStatus.CREATED, to: MatchStatus.COUNTDOWN },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.COUNTDOWN);
    // currentRoundNo is not on the event payload — must be untouched.
    expect(result.match?.currentRoundNo).toBe(0);
    expect(result.lastSeenSeqNo).toBe(1);
  });

  it("ROUND_STARTED: enriches roundNo, question, endsAt and sets status ROUND_ACTIVE", () => {
    const state = makeState({
      match: makeMatch({
        status: MatchStatus.ROUND_RESULT,
        currentRoundNo: 1,
        roundEndTime: null,
      }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_STARTED",
          timestamp: 1,
          payload: {
            roundNo: 3,
            questionId: "q1",
            question: {
              id: "q1",
              content: "Capital of France?",
              options: ["Paris", "Berlin"],
              difficulty: "EASY",
            },
            endsAt: 5000,
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.ROUND_ACTIVE);
    expect(result.match?.currentRoundNo).toBe(3);
    expect(result.match?.currentQuestion).toEqual({
      id: "q1",
      content: "Capital of France?",
      options: ["Paris", "Berlin"],
      difficulty: "EASY",
    });
    expect(result.match?.roundEndTime).toBe(5000);
    expect(result.lastSeenSeqNo).toBe(1);
  });

  it("ROUND_STARTED: payload.question never carries correctAnswer (L3 invariant)", () => {
    // The Plan D1 enrichment ensures the wire payload has the full
    // client-safe question so a delta can rebuild the in-flight round.
    // L3 still applies: correctAnswer must NEVER appear on the wire,
    // even via the delta envelope.
    const state = makeState({ match: makeMatch(), lastSeenSeqNo: 0 });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_STARTED",
          timestamp: 1,
          payload: {
            roundNo: 1,
            questionId: "q1",
            question: {
              id: "q1",
              content: "Q?",
              options: ["A", "B"],
            },
            endsAt: 1,
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.currentQuestion).not.toHaveProperty("correctAnswer");
  });

  it("ROUND_EVALUATED: stamps ELIMINATED on listed players, sets remainingCount, status ROUND_RESULT, roundEndTime=null", () => {
    const state = makeState({ match: makeMatch(), lastSeenSeqNo: 0 });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 1,
            correctAnswer: "B",
            survivingCount: 1,
            eliminatedCount: 1,
            eliminatedIds: ["p2"],
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.ROUND_RESULT);
    expect(result.match?.roundEndTime).toBeNull();
    expect(result.match?.players.find((p) => p.id === "p2")?.status).toBe(
      PlayerStatus.ELIMINATED,
    );
    expect(result.match?.players.find((p) => p.id === "p1")?.status).toBe(
      PlayerStatus.ACTIVE,
    );
    expect(result.remainingCount).toBe(1);
  });

  it("MATCH_FINISHED: status FINISHED, roundEndTime=null, other fields preserved", () => {
    const state = makeState({
      match: makeMatch({ currentRoundNo: 5 }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "MATCH_FINISHED",
          timestamp: 1,
          payload: { winnerId: "p1", totalRounds: 5 },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.FINISHED);
    expect(result.match?.roundEndTime).toBeNull();
    // currentRoundNo not in payload — preserved.
    expect(result.match?.currentRoundNo).toBe(5);
    expect(result.lastSeenSeqNo).toBe(1);
  });

  // ----- Group D — No-op events (Plan D1 §6b) -----

  it("no-op event types advance the cursor but leave match state untouched", () => {
    // ANSWER_SUBMITTED / TIE_BREAK / PLAYER_DISCONNECTED / PLAYER_RECONNECTED
    // do not change the rendered match — mirror live play. The cursor
    // still advances so the next requestSnapshot returns only NEWER events.
    const state = makeState({ match: makeMatch(), lastSeenSeqNo: 0 });
    const before = state.match;
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ANSWER_SUBMITTED",
          timestamp: 1,
          payload: { playerId: "p1", isCorrect: true, responseTimeMs: 100 },
          seqNo: 1,
        },
        {
          id: "m1:2",
          type: "TIE_BREAK",
          timestamp: 2,
          payload: { winnerId: "p1", tiedPlayerIds: ["p1"] },
          seqNo: 2,
        },
        {
          id: "m1:3",
          type: "PLAYER_DISCONNECTED",
          timestamp: 3,
          payload: { playerId: "p1" },
          seqNo: 3,
        },
        {
          id: "m1:4",
          type: "PLAYER_RECONNECTED",
          timestamp: 4,
          payload: { playerId: "p1" },
          seqNo: 4,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.ROUND_ACTIVE);
    expect(result.match?.players).toEqual(before?.players);
    expect(result.match?.roundEndTime).toBeNull();
    // Cursor advances despite no match-state change.
    expect(result.lastSeenSeqNo).toBe(4);
  });

  // ----- Group E — Idempotency (Plan D1 §7) -----

  it("skips events with seqNo <= cursor (idempotent on duplicate / out-of-order)", () => {
    // cursor = 5; the batch contains a mix of stale (3, 4) and fresh
    // (6) events. Only seqNo=6 must apply, and the cursor must end at 6.
    const state = makeState({
      match: makeMatch({ status: MatchStatus.COUNTDOWN }),
      lastSeenSeqNo: 5,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:3",
          type: "MATCH_FINISHED",
          timestamp: 1,
          payload: { winnerId: "p1", totalRounds: 3 },
          seqNo: 3, // <= 5: skip
        },
        {
          id: "m1:6",
          type: "STATE_TRANSITION",
          timestamp: 2,
          payload: { from: MatchStatus.CREATED, to: MatchStatus.COUNTDOWN },
          seqNo: 6, // apply
        },
        {
          id: "m1:4",
          type: "MATCH_FINISHED",
          timestamp: 3,
          payload: { winnerId: "p2", totalRounds: 3 },
          seqNo: 4, // <= 5: skip
        },
      ]),
    );

    // From seqNo=6 the reducer ran STATE_TRANSITION to COUNTDOWN. Since
    // the match was already COUNTDOWN, status stays the same — the
    // important signal is that seqNo=3 / 4 (the MATCH_FINISHED events)
    // were NOT applied.
    expect(result.match?.status).toBe(MatchStatus.COUNTDOWN);
    expect(result.lastSeenSeqNo).toBe(6);
  });

  it("cursor advances to the highest applied seqNo across the batch", () => {
    const state = makeState({ match: makeMatch(), lastSeenSeqNo: 5 });
    const result = applyEventBatchState(
      state,
      makeBatch([
        // Only the no-op branches apply here, but the cursor must
        // still advance to the max seqNo in the batch.
        {
          id: "m1:10",
          type: "ANSWER_SUBMITTED",
          timestamp: 1,
          payload: { playerId: "p1", isCorrect: true, responseTimeMs: 1 },
          seqNo: 10,
        },
        {
          id: "m1:20",
          type: "TIE_BREAK",
          timestamp: 2,
          payload: { winnerId: "p1", tiedPlayerIds: ["p1"] },
          seqNo: 20,
        },
        {
          id: "m1:30",
          type: "PLAYER_RECONNECTED",
          timestamp: 3,
          payload: { playerId: "p1" },
          seqNo: 30,
        },
      ]),
    );

    expect(result.lastSeenSeqNo).toBe(30);
  });

  it("skips invalid payload shapes without mutating match, still advances cursor", () => {
    const match = makeMatch({
      status: MatchStatus.COUNTDOWN,
      currentRoundNo: 1,
      currentQuestion: null,
    });
    const state = makeState({ match, lastSeenSeqNo: 0 });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_STARTED",
          timestamp: 1,
          // Missing question / endsAt — must not fold.
          payload: { roundNo: 2 },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match).toBe(match);
    expect(result.match?.status).toBe(MatchStatus.COUNTDOWN);
    expect(result.match?.currentRoundNo).toBe(1);
    expect(result.lastSeenSeqNo).toBe(1);
  });

  it("applies a valid event after an invalid one in the same batch", () => {
    const state = makeState({
      match: makeMatch({ status: MatchStatus.CREATED }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "STATE_TRANSITION",
          timestamp: 1,
          payload: { from: "not-a-status", to: MatchStatus.COUNTDOWN },
          seqNo: 1,
        },
        {
          id: "m1:2",
          type: "STATE_TRANSITION",
          timestamp: 2,
          payload: { from: MatchStatus.CREATED, to: MatchStatus.COUNTDOWN },
          seqNo: 2,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.COUNTDOWN);
    expect(result.lastSeenSeqNo).toBe(2);
  });

  // ----- Group F — Ranh giới không-đụng (Plan D1 §6b) -----

  it("does not overwrite players[].score or players[].isOnline", () => {
    // Plan D1 §6b: score is only refreshed via full SNAPSHOT; presence
    // lives on room.players. The delta deliberately leaves both fields
    // untouched so a reconnecting client matches a continuously
    // connected one. Setup with non-zero scores + mixed online flags
    // and verify they survive the fold.
    const customPlayers = [
      {
        id: "p1",
        name: "Alice",
        status: PlayerStatus.ACTIVE,
        score: 100,
        isOnline: false,
      },
      {
        id: "p2",
        name: "Bob",
        status: PlayerStatus.ACTIVE,
        score: 200,
        isOnline: true,
      },
    ];
    const state = makeState({
      match: makeMatch({ players: customPlayers }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 1,
            correctAnswer: "B",
            survivingCount: 1,
            eliminatedCount: 1,
            eliminatedIds: ["p2"],
          },
          seqNo: 1,
        },
      ]),
    );

    const p1 = result.match?.players.find((p) => p.id === "p1");
    const p2 = result.match?.players.find((p) => p.id === "p2");
    expect(p1?.score).toBe(100);
    expect(p1?.isOnline).toBe(false);
    expect(p1?.status).toBe(PlayerStatus.ACTIVE);
    expect(p2?.score).toBe(200);
    expect(p2?.isOnline).toBe(true);
    expect(p2?.status).toBe(PlayerStatus.ELIMINATED);
  });

  // ----- Group G — Self-eliminated recompute (mirror applySnapshotState) -----

  it("sets isEliminated=true when the local player lands in eliminatedIds", () => {
    // userId is "p1" in makeState.
    const state = makeState({ match: makeMatch(), lastSeenSeqNo: 0 });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 1,
            correctAnswer: "B",
            survivingCount: 1,
            eliminatedCount: 1,
            eliminatedIds: ["p1"],
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.isEliminated).toBe(true);
  });

  it("clears isEliminated when the new roster shows the local player ACTIVE", () => {
    // Defends the reconnect-via-delta path: a stale elimination flag
    // must not survive a delta that proves the player is still alive.
    const state = makeState({
      match: makeMatch(),
      lastSeenSeqNo: 0,
      isEliminated: true,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 1,
            correctAnswer: "B",
            survivingCount: 2,
            eliminatedCount: 0,
            eliminatedIds: [],
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.isEliminated).toBe(false);
  });
});

// Plan D — match-boundary cursor reset: applyMatchStartedState must
// zero the delta cursor when a new match begins so a stale seqNo from
// the previous match (e.g. from a long-running tab that survived
// multiple matches) cannot qualify for delta delivery against the
// new match's event log.
describe("applyMatchStartedState — Plan D cursor reset on match boundary", () => {
  it("resets lastSeenSeqNo to 0 regardless of the prior cursor", () => {
    const state = makeState({
      room: {
        id: "r1",
        code: "ABC",
        status: RoomStatus.STARTING,
        hostId: "p1",
        roomType: "PUBLIC" satisfies RoomType,
        currentMatchId: "m-new",
        countdownEndsAt: null,
        players: basePlayers,
        joinMode: "PLAYER" satisfies JoinMode,
        maxPlayers: 100,
      },
      match: {
        // Prior match — its seqNo namespace must NOT bleed into the
        // new match's delta window.
        id: "m-old",
        status: MatchStatus.FINISHED,
        currentRoundNo: 5,
        players: basePlayers,
        currentQuestion: null,
        roundEndTime: null,
      },
      lastSeenSeqNo: 50,
    });
    const result = applyMatchStartedState(state, {
      matchId: "m-new",
      roomId: "r1",
      status: MatchStatus.COUNTDOWN,
      countdownMs: 3000,
    });

    expect(result.lastSeenSeqNo).toBe(0);
    // Sanity: other Plan-C reset invariants are preserved alongside.
    expect(result.isEliminated).toBe(false);
    expect(result.eliminationReason).toBeNull();
    expect(result.match?.id).toBe("m-new");
  });
});

describe("applyEventBatchState — Plan D mirror live updaters", () => {
  // Group H — mirror the live updaters' side effects so a client that
  // reconnects via delta converges to the same state as a continuously
  // connected client.

  it("ROUND_STARTED clears lastAnswerResult and pendingAnswer (mirror live)", () => {
    // Live applyRoundStartedState clears both fields. A delta that
    // opens a new round must do the same, otherwise the answer panel
    // would keep the previous round's result + a stale pending
    // submission while showing the new question.
    const state = makeState({
      match: makeMatch({ currentRoundNo: 1, currentQuestion: null }),
      room: makeRoom(),
      lastAnswerResult: {
        matchId: "m1",
        roundNo: 1,
        isCorrect: true,
        responseTimeMs: 500,
        correctAnswer: "A",
      },
      pendingAnswer: {
        matchId: "m1",
        roundNo: 1,
        answer: "B",
        submissionId: "s-old",
      },
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_STARTED",
          timestamp: 1,
          payload: {
            roundNo: 2,
            questionId: "q2",
            question: { id: "q2", content: "New Q?", options: ["A", "B"] },
            endsAt: 5000,
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.currentRoundNo).toBe(2);
    expect(result.lastAnswerResult).toBeNull();
    expect(result.pendingAnswer).toBeNull();
  });

  it("ROUND_EVALUATED clears matching pendingAnswer (mirror live)", () => {
    // Live applyRoundEndedState clears pendingAnswer only when it
    // belongs to the round that just resolved. The delta case must
    // match — otherwise a player who submitted an answer mid-round
    // would carry a stale pending state into the round-result view.
    const state = makeState({
      match: makeMatch({ currentRoundNo: 3 }),
      room: makeRoom(),
      pendingAnswer: {
        matchId: "m1",
        roundNo: 3,
        answer: "A",
        submissionId: "s1",
      },
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 3,
            correctAnswer: "B",
            survivingCount: 1,
            eliminatedCount: 1,
            eliminatedIds: ["p2"],
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.pendingAnswer).toBeNull();
  });

  it("ROUND_EVALUATED preserves a pendingAnswer from a different round (mirror live)", () => {
    // Out-of-order delivery: a ROUND_EVALUATED arrives for round 3
    // while the client still has a pending answer for round 2 (e.g.
    // a delayed delta after a reconnect). The pending answer for
    // round 2 must be preserved so the client can resolve it.
    const pendingForRound2 = {
      matchId: "m1",
      roundNo: 2,
      answer: "A",
      submissionId: "s2",
    };
    const state = makeState({
      match: makeMatch({ currentRoundNo: 2 }),
      room: makeRoom(),
      pendingAnswer: pendingForRound2,
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "ROUND_EVALUATED",
          timestamp: 1,
          payload: {
            roundNo: 3,
            survivingCount: 2,
            eliminatedCount: 0,
            eliminatedIds: [],
          },
          seqNo: 1,
        },
      ]),
    );

    expect(result.pendingAnswer).toBe(pendingForRound2);
  });

  it("MATCH_FINISHED updates room.status to FINISHED and countdownEndsAt to null (mirror live)", () => {
    // Live applyMatchFinishedState flips the room channel so the
    // lobby / leave-flow observes the match end. A delta-induced
    // match end must mirror this so a reconnecting client does not
    // keep an open room with status IN_GAME after the match is over.
    const state = makeState({
      match: makeMatch({ currentRoundNo: 5 }),
      room: makeRoom({
        status: RoomStatus.IN_GAME,
        countdownEndsAt: 1000,
      }),
      lastSeenSeqNo: 0,
    });
    const result = applyEventBatchState(
      state,
      makeBatch([
        {
          id: "m1:1",
          type: "MATCH_FINISHED",
          timestamp: 1,
          payload: { winnerId: "p1", totalRounds: 5 },
          seqNo: 1,
        },
      ]),
    );

    expect(result.match?.status).toBe(MatchStatus.FINISHED);
    expect(result.room?.status).toBe(RoomStatus.FINISHED);
    expect(result.room?.countdownEndsAt).toBeNull();
  });

  describe("Topic Voting Updaters", () => {
    it("applyTopicVotingStartedState initializes topic voting state", () => {
      const state = makeState();
      const result = applyTopicVotingStartedState(state, {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: 10000,
        durationMs: 10000,
      });

      expect(result.match?.status).toBe(MatchStatus.TOPIC_VOTING);
      expect(result.topicVoting).toEqual({
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: 10000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: { SCIENCE: 0, HISTORY: 0, TECH: 0 },
        totalVotes: 0,
        bannedTopics: [],
        activeTopics: [],
        isFinished: false,
      });
    });

    it("applyTopicVotingSummaryState updates vote counts and total votes", () => {
      const state = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: "SCIENCE",
          voteCounts: { SCIENCE: 0, HISTORY: 0 },
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });

      const result = applyTopicVotingSummaryState(state, {
        matchId: "m1",
        voteCounts: { SCIENCE: 5, HISTORY: 2 },
        totalVotes: 7,
      });

      expect(result.topicVoting?.voteCounts).toEqual({
        SCIENCE: 5,
        HISTORY: 2,
      });
      expect(result.topicVoting?.totalVotes).toBe(7);
      expect(result.topicVoting?.myVotedTopic).toBe("SCIENCE");
    });

    it("applyTopicVotingFinishedState sets banned and active topics and updates voteCounts", () => {
      const state = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY", "TECH", "SPORTS"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: "SCIENCE",
          voteCounts: { SCIENCE: 1, HISTORY: 0, TECH: 0, SPORTS: 0 },
          totalVotes: 1,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });

      const result = applyTopicVotingFinishedState(state, {
        matchId: "m1",
        bannedTopics: ["SCIENCE", "HISTORY"],
        activeTopics: ["TECH", "SPORTS"],
        voteCounts: { SCIENCE: 5, HISTORY: 4, TECH: 1, SPORTS: 0 },
      });

      expect(result.topicVoting?.isFinished).toBe(true);
      expect(result.topicVoting?.bannedTopics).toEqual(["SCIENCE", "HISTORY"]);
      expect(result.topicVoting?.activeTopics).toEqual(["TECH", "SPORTS"]);
      expect(result.topicVoting?.voteCounts).toEqual({
        SCIENCE: 5,
        HISTORY: 4,
        TECH: 1,
        SPORTS: 0,
      });
    });

    it("applyTopicVotingStartedState ignores stale payload from different matchId", () => {
      const state = makeState({
        match: {
          id: "m1",
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 1,
          players: [],
          currentQuestion: null,
          roundEndTime: null,
        },
      });

      const result = applyTopicVotingStartedState(state, {
        matchId: "m-stale",
        candidateTopics: ["SCIENCE", "HISTORY"],
        endsAt: 10000,
        durationMs: 10000,
      });

      expect(result).toEqual({});
    });

    it("applySnapshotState restores topicVoting when candidateTopics are present", () => {
      const state = makeState({
        userId: "u1",
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.TOPIC_VOTING,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 1,
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        voteCounts: { SCIENCE: 2, HISTORY: 1, TECH: 0 },
        phaseEndsAt: 15000,
      });

      expect(result.topicVoting).toMatchObject({
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        voteCounts: { SCIENCE: 2, HISTORY: 1, TECH: 0 },
        totalVotes: 3,
        endsAt: 15000,
        isFinished: false,
      });
    });

    it("applySnapshotState restores banned and active topics on COUNTDOWN when topicVoting is null", () => {
      const state = makeState({
        userId: "u1",
        topicVoting: null,
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.COUNTDOWN,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 1,
        bannedTopics: ["HISTORY"],
        activeTopics: ["SCIENCE", "TECH"],
        phaseEndsAt: 20000,
      });

      expect(result.topicVoting).toMatchObject({
        matchId: "m1",
        bannedTopics: ["HISTORY"],
        activeTopics: ["SCIENCE", "TECH"],
        isFinished: true,
      });
    });

    it("applySnapshotState replaces non-empty local bannedTopics and activeTopics with empty arrays from snapshot", () => {
      const state = makeState({
        userId: "u1",
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE", "TECH"],
          isFinished: false,
        },
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.TOPIC_VOTING,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 2,
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        bannedTopics: [],
        activeTopics: [],
      });

      expect(result.topicVoting?.bannedTopics).toEqual([]);
      expect(result.topicVoting?.activeTopics).toEqual([]);
    });

    it("applySnapshotState replaces non-empty local bannedTopics and activeTopics with empty arrays when candidateTopics is omitted in snapshot", () => {
      const state = makeState({
        userId: "u1",
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE", "TECH"],
          isFinished: false,
        },
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.TOPIC_VOTING,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 2,
        bannedTopics: [],
        activeTopics: [],
      });

      expect(result.topicVoting?.bannedTopics).toEqual([]);
      expect(result.topicVoting?.activeTopics).toEqual([]);
      expect(result.topicVoting?.candidateTopics).toEqual([
        "SCIENCE",
        "HISTORY",
        "TECH",
      ]);
    });

    it("applySnapshotState replaces non-empty local bannedTopics and activeTopics with different snapshot lists", () => {
      const state = makeState({
        userId: "u1",
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE", "TECH"],
          isFinished: false,
        },
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.COUNTDOWN,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 2,
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        bannedTopics: ["SCIENCE"],
        activeTopics: ["HISTORY", "TECH"],
      });

      expect(result.topicVoting?.bannedTopics).toEqual(["SCIENCE"]);
      expect(result.topicVoting?.activeTopics).toEqual(["HISTORY", "TECH"]);
    });

    it("applySnapshotState sets topicVoting to null when status is ROUND_ACTIVE or beyond", () => {
      const state = makeState({
        userId: "u1",
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: true,
        },
      });

      const result = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 5,
        candidateTopics: ["SCIENCE"],
      });

      expect(result.topicVoting).toBeNull();
    });

    it("applyRoundStartedState clears topicVoting to null", () => {
      const state = makeState({
        userId: "u1",
        match: {
          id: "m1",
          status: MatchStatus.COUNTDOWN,
          currentRoundNo: 0,
          players: [],
          currentQuestion: null,
          roundEndTime: null,
        },
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE"],
          isFinished: true,
        },
      });

      const result = applyRoundStartedState(state, {
        matchId: "m1",
        roundNo: 1,
        question: {
          id: "q1",
          content: "What is H2O?",
          options: ["Water", "Air", "Fire", "Earth"],
        },
        startedAt: 15000,
        endsAt: 30000,
      });

      expect(result.topicVoting).toBeNull();
    });

    it("applySnapshotState handles COUNTDOWN status with existing topic voting matchId to set isFinished true", () => {
      const state = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });

      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.COUNTDOWN,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 3,
      });

      expect(res.topicVoting?.isFinished).toBe(true);
    });

    it("applySnapshotState handles activeTopics only when candidateTopics is empty", () => {
      const state = makeState({ topicVoting: null });
      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.COUNTDOWN,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 3,
        activeTopics: ["SCIENCE", "TECH"],
      });

      expect(res.topicVoting?.activeTopics).toEqual(["SCIENCE", "TECH"]);
      expect(res.topicVoting?.candidateTopics).toEqual([]);
    });

    it("applySnapshotState updates room state when state.room is present", () => {
      const state = makeState({
        room: makeRoom({
          status: RoomStatus.COUNTDOWN,
          countdownEndsAt: 12345,
          currentMatchId: null,
        }),
      });
      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: [],
        currentQuestion: null,
        roundEndTime: 20000,
        lastEventSeqNo: 5,
      });
      expect(res.room?.status).toBe(RoomStatus.IN_GAME);
      expect(res.room?.currentMatchId).toBe("m1");
      expect(res.room?.countdownEndsAt).toBeNull();
    });

    it("applySnapshotState updates room currentMatchId from a different previous match ID", () => {
      const state = makeState({
        room: makeRoom({
          status: RoomStatus.WAITING,
          currentMatchId: "m-prev",
        }),
      });
      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: [],
        currentQuestion: null,
        roundEndTime: 20000,
        lastEventSeqNo: 5,
      });
      expect(res.room?.currentMatchId).toBe("m1");
    });

    it("applySnapshotState preserves prior bannedTopics/activeTopics when candidateTopics present and snapshot topic arrays are undefined", () => {
      const state = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "TECH"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: "SCIENCE",
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE"],
          isFinished: false,
        },
      });

      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.TOPIC_VOTING,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 2,
        candidateTopics: ["SCIENCE", "TECH"],
      });

      expect(res.topicVoting?.bannedTopics).toEqual(["HISTORY"]);
      expect(res.topicVoting?.activeTopics).toEqual(["SCIENCE"]);
      expect(res.topicVoting?.myVotedTopic).toBe("SCIENCE");
    });

    it("applySnapshotState returns null topicVoting on COUNTDOWN when all topic arrays are empty and topicVoting is null", () => {
      const state = makeState({ topicVoting: null });
      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.COUNTDOWN,
        currentRoundNo: 0,
        players: [],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 3,
      });

      expect(res.topicVoting).toBeNull();
    });

    it("applySnapshotState handles null userId without throwing and sets isEliminated false", () => {
      const state = makeState({ userId: null });
      const res = applySnapshotState(state, {
        matchId: "m1",
        status: MatchStatus.ROUND_ACTIVE,
        currentRoundNo: 1,
        players: [
          {
            id: "p1",
            name: "Alice",
            status: PlayerStatus.ACTIVE,
            score: 0,
            isOnline: true,
          },
        ],
        currentQuestion: null,
        roundEndTime: null,
        lastEventSeqNo: 1,
      });
      expect(res.isEliminated).toBe(false);
    });
  });

  describe("applyRoundEndedState with priorForThisRound", () => {
    it("copies prior isCorrect and responseTimeMs into lastAnswerResult", () => {
      const state = makeState({ match: makeMatch() });
      const res = applyRoundEndedState(
        state,
        {
          matchId: "m1",
          roundNo: 1,
          correctAnswer: "A",
          eliminatedPlayerIds: [],
          survivingPlayerIds: ["p1", "p2"],
        },
        {
          matchId: "m1",
          roundNo: 1,
          isCorrect: true,
          responseTimeMs: 350,
          correctAnswer: "A",
        },
      );

      expect(res.lastAnswerResult?.isCorrect).toBe(true);
      expect(res.lastAnswerResult?.responseTimeMs).toBe(350);
    });
  });

  describe("applyAuthenticatedState", () => {
    it("updates authentication credentials and flags", () => {
      const res = applyAuthenticatedState({
        userId: "u1",
        username: "Player1",
      });
      expect(res).toEqual({
        isAuthenticated: true,
        userId: "u1",
        username: "Player1",
      });
    });
  });

  describe("applyRoomCreatedState and applyRoomJoinedState", () => {
    it("applyRoomCreatedState initializes room and resets match/answer state", () => {
      const payload = {
        roomId: "r1",
        code: "ABC",
        roomStatus: RoomStatus.WAITING,
        hostId: "u1",
        roomType: "PUBLIC" satisfies RoomType,
        maxPlayers: 10,
        currentMatchId: null,
        joinedAs: "PLAYER" satisfies JoinMode,
        players: [{ playerId: "u1", playerName: "Host", isOnline: true }],
      } satisfies RoomCreatedPayload;
      const res = applyRoomCreatedState(payload);

      expect(res.room?.id).toBe("r1");
      expect(res.room?.players).toHaveLength(1);
      expect(res.match).toBeNull();
      expect(res.isEliminated).toBe(false);
    });

    it("applyRoomJoinedState initializes joined room", () => {
      const payload = {
        roomId: "r2",
        code: "XYZ",
        roomStatus: RoomStatus.WAITING,
        hostId: "u1",
        roomType: "PUBLIC" satisfies RoomType,
        maxPlayers: 10,
        currentMatchId: null,
        countdownEndsAt: 12345,
        joinedAs: "SPECTATOR" satisfies JoinMode,
        players: [{ playerId: "u2", playerName: "Guest", isOnline: true }],
      } satisfies RoomJoinedPayload;
      const res = applyRoomJoinedState(payload);

      expect(res.room?.id).toBe("r2");
      expect(res.room?.joinMode).toBe("SPECTATOR");
      expect(res.room?.countdownEndsAt).toBe(12345);
    });
  });

  describe("applyPlayerJoinedState and applyPlayerLeftState", () => {
    it("applyPlayerJoinedState adds a new player when not in room", () => {
      const state = makeState({
        room: makeRoom({ players: [basePlayers[0]] }),
      });
      const res = applyPlayerJoinedState(state, {
        roomId: "r1",
        playerId: "p2",
        playerName: "Bob",
        isOnline: true,
      });

      expect(res.room?.players).toHaveLength(2);
      expect(res.room?.players.some((p) => p.id === "p2")).toBe(true);
    });

    it("applyPlayerJoinedState updates player info when already in room", () => {
      const state = makeState({
        room: makeRoom({ players: basePlayers }),
      });
      const res = applyPlayerJoinedState(state, {
        roomId: "r1",
        playerId: "p1",
        playerName: "AliceUpdated",
        isOnline: false,
      });

      expect(res.room?.players[0].name).toBe("AliceUpdated");
      expect(res.room?.players[0].isOnline).toBe(false);
      expect(res.room?.players[1].name).toBe("Bob");
    });

    it("applyPlayerJoinedState returns state unchanged when roomId does not match", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyPlayerJoinedState(state, {
        roomId: "r-other",
        playerId: "p2",
        playerName: "Bob",
        isOnline: true,
      });
      expect(res).toBe(state);
    });

    it("applyPlayerLeftState removes player from matching room", () => {
      const state = makeState({ room: makeRoom({ players: basePlayers }) });
      const res = applyPlayerLeftState(state, {
        roomId: "r1",
        playerId: "p1",
        reason: "LEFT",
      });
      expect(res.room?.players).toHaveLength(1);
      expect(res.room?.players[0].id).toBe("p2");
    });

    it("applyPlayerLeftState returns state unchanged when roomId does not match", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyPlayerLeftState(state, {
        roomId: "r-other",
        playerId: "p1",
        reason: "LEFT",
      });
      expect(res).toBe(state);
    });
  });

  describe("Room lifecycle updaters (status, countdown, presence, termination)", () => {
    it("applyRoomStatusUpdatedState updates status and nulls countdownEndsAt", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomStatusUpdatedState(state, {
        roomId: "r1",
        roomStatus: RoomStatus.COUNTDOWN,
        currentMatchId: "m1",
        updatedAt: 1000,
      });
      expect(res.room?.status).toBe(RoomStatus.COUNTDOWN);
      expect(res.room?.countdownEndsAt).toBeNull();
    });

    it("applyRoomStatusUpdatedState returns state when roomId differs", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomStatusUpdatedState(state, {
        roomId: "r-diff",
        roomStatus: RoomStatus.COUNTDOWN,
        currentMatchId: null,
        updatedAt: 1000,
      });
      expect(res).toBe(state);
    });

    it("applyRoomCountdownStartedState sets countdown timestamp", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomCountdownStartedState(state, {
        roomId: "r1",
        roomStatus: RoomStatus.COUNTDOWN,
        countdownEndsAt: 99999,
        countdownMs: 10000,
        startedAt: 1000,
      });
      expect(res.room?.countdownEndsAt).toBe(99999);
    });

    it("applyRoomCountdownStartedState returns state when roomId differs", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomCountdownStartedState(state, {
        roomId: "r-diff",
        roomStatus: RoomStatus.COUNTDOWN,
        countdownEndsAt: 99999,
        countdownMs: 10000,
        startedAt: 1000,
      });
      expect(res).toBe(state);
    });

    it("applyRoomCountdownCancelledState resets countdown timestamp", () => {
      const state = makeState({
        room: makeRoom({ countdownEndsAt: 99999 }),
      });
      const res = applyRoomCountdownCancelledState(state, {
        roomId: "r1",
        roomStatus: RoomStatus.WAITING,
        reason: "HOST_CANCELLED",
        cancelledAt: 1000,
      });
      expect(res.room?.countdownEndsAt).toBeNull();
      expect(res.room?.status).toBe(RoomStatus.WAITING);
    });

    it("applyRoomCountdownCancelledState returns state when roomId differs", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomCountdownCancelledState(state, {
        roomId: "r-diff",
        roomStatus: RoomStatus.WAITING,
        reason: "HOST_CANCELLED",
        cancelledAt: 1000,
      });
      expect(res).toBe(state);
    });

    it("applyRoomPresenceUpdatedState updates online status of matching player", () => {
      const state = makeState({ room: makeRoom({ players: basePlayers }) });
      const res = applyRoomPresenceUpdatedState(state, {
        roomId: "r1",
        playerId: "p1",
        isOnline: false,
        updatedAt: 1000,
      });
      expect(res.room?.players.find((p) => p.id === "p1")?.isOnline).toBe(
        false,
      );
      expect(res.room?.players.find((p) => p.id === "p2")?.isOnline).toBe(true);
    });

    it("applyRoomPresenceUpdatedState returns state when roomId differs", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyRoomPresenceUpdatedState(state, {
        roomId: "r-diff",
        playerId: "p1",
        isOnline: false,
        updatedAt: 1000,
      });
      expect(res).toBe(state);
    });

    it("applyRoomTerminatedState cleans up room and match state", () => {
      const res = applyRoomTerminatedState({
        roomId: "r1",
        reason: "ADMIN_TERMINATED",
        matchId: null,
        message: "Room closed by administrator",
        terminatedAt: 1000,
      });
      expect(res.room).toBeNull();
      expect(res.match).toBeNull();
      expect(res.roomTerminated).toBe(true);
      expect(res.roomTerminationMessage).toBe("Room closed by administrator");
    });
  });

  describe("Match starting and elimination updaters", () => {
    it("applyMatchStartingState sets room status to STARTING", () => {
      const state = makeState({ room: makeRoom() });
      const res = applyMatchStartingState(state, {
        matchId: "m1",
        countdown: 5,
      });
      expect(res.room?.status).toBe(RoomStatus.STARTING);
      expect(res.room?.currentMatchId).toBe("m1");
    });

    it("applyMatchStartingState handles null room safely", () => {
      const state = makeState({ room: null });
      const res = applyMatchStartingState(state, {
        matchId: "m1",
        countdown: 5,
      });
      expect(res.room).toBeNull();
    });

    it("applyMatchStartedState handles null room safely", () => {
      const state = makeState({ room: null });
      const res = applyMatchStartedState(state, {
        matchId: "m1",
        roomId: "r1",
        status: MatchStatus.COUNTDOWN,
        countdownMs: 5000,
      });
      expect(res.room).toBeNull();
      expect(res.match?.id).toBe("m1");
    });

    it("applyPlayerEliminatedState marks eliminated player in match", () => {
      const state = makeState({ match: makeMatch({ players: basePlayers }) });
      const res = applyPlayerEliminatedState(state, {
        matchId: "m1",
        roundNo: 1,
        playerId: "p1",
        reason: "WRONG_ANSWER",
      });
      expect(res.match?.players.find((p) => p.id === "p1")?.status).toBe(
        PlayerStatus.ELIMINATED,
      );
    });

    it("applyPlayerEliminatedState returns state unchanged when match is null", () => {
      const state = makeState({ match: null });
      const res = applyPlayerEliminatedState(state, {
        matchId: "m1",
        roundNo: 1,
        playerId: "p1",
        reason: "WRONG_ANSWER",
      });
      expect(res).toBe(state);
    });
  });

  describe("Topic Voting additional branch coverage", () => {
    it("applyTopicVotingStartedState updates existing match status and fields when matchId matches", () => {
      const state = makeState({
        match: makeMatch({ id: "m1", status: MatchStatus.COUNTDOWN }),
      });
      const res = applyTopicVotingStartedState(state, {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY"],
        endsAt: 10000,
        durationMs: 10000,
      });
      expect(res.match?.status).toBe(MatchStatus.TOPIC_VOTING);
      expect(res.match?.id).toBe("m1");
      expect(res.topicVoting?.candidateTopics).toEqual(["SCIENCE", "HISTORY"]);
    });

    it("applyTopicVotingStartedState creates new match when state.match.id differs or is null", () => {
      const state = makeState({
        room: makeRoom({ id: "r1", currentMatchId: "m2", players: [] }),
        match: makeMatch({
          id: "m1",
          status: MatchStatus.FINISHED,
          currentRoundNo: 5,
        }),
      });
      const res = applyTopicVotingStartedState(state, {
        matchId: "m2",
        candidateTopics: ["SCIENCE", "HISTORY"],
        endsAt: 10000,
        durationMs: 10000,
      });
      expect(res.match?.id).toBe("m2");
      expect(res.match?.currentRoundNo).toBe(0);
      expect(res.match?.status).toBe(MatchStatus.TOPIC_VOTING);
    });

    it("applyTopicVotingSummaryState returns empty object when topicVoting is null or matchId mismatch", () => {
      const state = makeState({ topicVoting: null });
      expect(
        applyTopicVotingSummaryState(state, {
          matchId: "m1",
          voteCounts: {},
          totalVotes: 0,
        }),
      ).toEqual({});

      const state2 = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });
      expect(
        applyTopicVotingSummaryState(state2, {
          matchId: "m-diff",
          voteCounts: {},
          totalVotes: 0,
        }),
      ).toEqual({});
    });

    it("applyTopicVotingFinishedState returns empty object when topicVoting is null or matchId mismatch", () => {
      const state = makeState({ topicVoting: null });
      expect(
        applyTopicVotingFinishedState(state, {
          matchId: "m1",
          bannedTopics: [],
          activeTopics: [],
          voteCounts: {},
        }),
      ).toEqual({});

      const state2 = makeState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE"],
          endsAt: 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: {},
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });
      expect(
        applyTopicVotingFinishedState(state2, {
          matchId: "m-diff",
          bannedTopics: [],
          activeTopics: [],
          voteCounts: {},
        }),
      ).toEqual({});
    });

    it("applyAnswerResultState returns empty object when state.match.id does not match data.matchId", () => {
      const state = makeState({ match: makeMatch({ id: "m-other" }) });
      const res = applyAnswerResultState(state, {
        matchId: "m-new",
        roundNo: 1,
        submissionId: "sub1",
        isCorrect: true,
        responseTimeMs: 200,
      });
      expect(res).toEqual({});
    });

    it("applyMatchmakingStatusState updates matchmaking state correctly and clears stale error", () => {
      const state = makeState({
        error: "Previous socket error",
        matchmaking: {
          isQueued: false,
          queuedAt: null,
          elapsedSeconds: 0,
          estimatedWaitSeconds: 0,
          playersInQueue: 0,
          matchedRoomCode: "PREV_CODE",
          matchedRoomId: "prev-id",
          matchedMatchId: null,
        },
      });
      const res = applyMatchmakingStatusState(state, {
        isQueued: true,
        queuedAt: 1000,
        elapsedSeconds: 10,
        estimatedWaitSeconds: 20,
        playersInQueue: 5,
      });
      expect(res.error).toBeNull();
      expect(res.matchmaking).toEqual({
        isQueued: true,
        queuedAt: 1000,
        elapsedSeconds: 10,
        estimatedWaitSeconds: 20,
        playersInQueue: 5,
        matchedRoomCode: "PREV_CODE",
        matchedRoomId: "prev-id",
        matchedMatchId: null,
      });
    });

    it("applyMatchmakingMatchedState updates matchmaking state with roomCode", () => {
      const state = makeState({
        matchmaking: {
          isQueued: true,
          queuedAt: 1000,
          elapsedSeconds: 15,
          estimatedWaitSeconds: 15,
          playersInQueue: 10,
          matchedRoomCode: null,
          matchedRoomId: null,
          matchedMatchId: null,
        },
      });
      const res = applyMatchmakingMatchedState(state, {
        roomId: "r-123",
        roomCode: "MATCH1",
        matchId: "m-123",
      });
      expect(res.matchmaking).toEqual({
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 0,
        playersInQueue: 10,
        matchedRoomCode: "MATCH1",
        matchedRoomId: "r-123",
        matchedMatchId: "m-123",
      });
    });

    it("applyClassAssignedState updates player class and roster", () => {
      const state = makeState({
        userId: "p1",
      });

      const res = applyClassAssignedState(state, {
        matchId: "m1",
        assignments: [
          { playerId: "p1", classId: "ATTACK" as ClassId },
          { playerId: "p2", classId: "DEFENSE" as ClassId },
        ],
        seedUsed: "seed-1",
      });

      expect(res.cardState?.classId).toBe("ATTACK");
    });

    it("applyCardOfferState sets currentOffer for matching player", () => {
      const state = makeState({
        userId: "p1",
      });

      const res = applyCardOfferState(state, {
        matchId: "m1",
        roundNo: 5,
        playerId: "p1",
        offeredCardIds: ["CB-1", "CB-2", "CB-3"] as unknown as readonly [
          CardId,
          CardId,
          CardId,
        ],
        offerSeqNo: 42,
        seedUsed: "seed-offer",
      });

      expect(res.cardState?.currentOffer?.roundNo).toBe(5);
      expect(res.cardState?.currentOffer?.offeredCardIds).toEqual([
        "CB-1",
        "CB-2",
        "CB-3",
      ]);
      expect(res.cardState?.currentOffer?.offerSeqNo).toBe(42);
    });

    it("applyCardPickedState adds card to hand and clears currentOffer", () => {
      const state = makeState({
        userId: "p1",
        cardState: {
          ...INITIAL_CARD_STATE,
          classId: "ATTACK" as ClassId,
          hand: ["CB-1" as CardId],
          currentOffer: {
            matchId: "m1",
            roundNo: 5,
            offeredCardIds: ["CB-1", "CB-2", "CB-3"] as unknown as readonly [
              CardId,
              CardId,
              CardId,
            ],
            offerSeqNo: 42,
            seedUsed: "seed-offer",
            expiresAt: 9999,
          },
        },
      });

      const res = applyCardPickedState(state, {
        matchId: "m1",
        roundNo: 5,
        playerId: "p1",
        selectedCardId: "CB-2" as CardId,
        offerSeqNo: 42,
      });

      expect(res.cardState?.hand).toEqual(["CB-1", "CB-2"]);
      expect(res.cardState?.currentOffer).toBeNull();
    });

    it("applyCardResolvedState records playedCardIds for self-played cards", () => {
      const state = makeState({
        userId: "p1",
        cardState: {
          ...INITIAL_CARD_STATE,
          classId: "ATTACK" as ClassId,
          hand: ["CB-1" as CardId, "CB-2" as CardId],
        },
      });

      const res = applyCardResolvedState(state, {
        cardId: "CB-2" as CardId,
        playedByPlayerId: "p1",
        effect: { kind: "TIMER_MODIFY", deltaMs: -5000 },
      } as unknown as CardEffectEvent);

      expect(res.cardState?.playedCardIds).toEqual(["CB-2"]);
      expect(res.cardState?.lastResolvedEffect).toBeDefined();
    });

    it("applyRoundEndedState marks unlisted players as ELIMINATED when survivingPlayerIds is provided", () => {
      const state = makeState({
        match: {
          id: "m1",
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 7,
          players: [
            {
              id: "p1",
              name: "P1",
              status: PlayerStatus.ACTIVE,
              score: 10,
              isOnline: true,
            },
            {
              id: "p2",
              name: "P2",
              status: PlayerStatus.ACTIVE,
              score: 10,
              isOnline: true,
            },
            {
              id: "p3",
              name: "P3",
              status: PlayerStatus.ACTIVE,
              score: 10,
              isOnline: true,
            },
            {
              id: "p4",
              name: "P4",
              status: PlayerStatus.ACTIVE,
              score: 10,
              isOnline: true,
            },
            {
              id: "p5",
              name: "P5",
              status: PlayerStatus.ACTIVE,
              score: 10,
              isOnline: true,
            },
          ],
          currentQuestion: null,
          roundEndTime: null,
        },
      });

      // Round ended where only p1, p2, p3 survived (p4 and p5 eliminated in earlier or current rounds)
      const res = applyRoundEndedState(
        state,
        {
          matchId: "m1",
          roundNo: 7,
          correctAnswer: "A",
          survivingPlayerIds: ["p1", "p2", "p3"],
          eliminatedPlayerIds: ["p5"],
        },
        null,
      );

      expect(res.remainingCount).toBe(3);
      const alive = res.match?.players?.filter(
        (p) => p.status !== PlayerStatus.ELIMINATED,
      );
      expect(alive?.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
      expect(res.match?.players?.find((p) => p.id === "p4")?.status).toBe(
        PlayerStatus.ELIMINATED,
      );
      expect(res.match?.players?.find((p) => p.id === "p5")?.status).toBe(
        PlayerStatus.ELIMINATED,
      );
    });
  });
});
