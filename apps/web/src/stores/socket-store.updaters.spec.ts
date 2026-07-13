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
  applyMatchFinishedState,
  applyRoundEndedState,
  applyRoundStartedState,
  applySnapshotState,
  applyUnauthorizedErrorState,
} from "./socket-store.updaters";
import type { SocketState } from "./socket-store.types";

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
});
