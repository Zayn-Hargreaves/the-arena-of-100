import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type SnapshotPayload,
} from "@arena/shared";
import type { JoinMode, RoomType } from "@arena/shared";
import { describe, expect, it } from "vitest";
import {
  applyAnswerResultState,
  applyEventBatchState,
  applyMatchFinishedState,
  applyRoundEndedState,
  applyRoundStartedState,
  applySnapshotState,
  applyUnauthorizedErrorState,
} from "./socket-store.updaters";
import type { Match, SocketState } from "./socket-store.types";
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
    const result = applyUnauthorizedErrorState("nope");

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

    const result = applyUnauthorizedErrorState("nope");

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
