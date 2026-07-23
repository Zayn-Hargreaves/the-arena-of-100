import { describe, it, expect, vi } from "vitest";
import { Server } from "socket.io";
import {
  ServerEvent,
  getPlayerChannel,
  getRoomChannel,
  GAME_CONFIG,
} from "@arena/shared";
import {
  emitAnswerResult,
  emitRoundStarted,
  emitRoundEnded,
  emitPlayerEliminated,
  emitMatchFinished,
  emitMatchPlayerLeft,
  emitMatchDisconnected,
} from "./game-loop.events";

function makeServer() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const server = { to } as unknown as Server;
  return { server, to, emit };
}

describe("emitAnswerResult", () => {
  it("emits to the SUBMITTER-ONLY player:${userId} channel, never the room channel", () => {
    const { server, to, emit } = makeServer();

    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p1",
      { submissionId: "sub-1", isCorrect: true, responseTimeMs: 250 },
      3,
    );

    expect(to).toHaveBeenCalledWith(getPlayerChannel("p1"));
    expect(to).not.toHaveBeenCalledWith("room:room-1");
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.ANSWER_RESULT,
      expect.objectContaining({
        matchId: "match-1",
        userId: "p1",
        submissionId: "sub-1",
        roundNo: 3,
        isCorrect: true,
        responseTimeMs: 250,
      }),
    );
  });

  it("routes different submitters to different channels (no cross-delivery)", () => {
    const { server, to, emit } = makeServer();

    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p1",
      { submissionId: "sub-1", isCorrect: true, responseTimeMs: 100 },
      1,
    );
    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p2",
      { submissionId: "sub-2", isCorrect: false, responseTimeMs: 200 },
      1,
    );

    expect(to).toHaveBeenNthCalledWith(1, getPlayerChannel("p1"));
    expect(to).toHaveBeenNthCalledWith(2, getPlayerChannel("p2"));
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe("emitRoundStarted", () => {
  it("emits to the room channel with the question stripped of correctAnswer and round timing", () => {
    const { server, to, emit } = makeServer();
    const state = {
      players: new Map<string, { name: string }>(),
      currentRoundNo: 4,
    };
    const question = {
      id: "q1",
      content: "What is 2+2?",
      options: ["3", "4", "5"],
      difficulty: "easy",
      correctAnswer: "4",
    };

    emitRoundStarted(server, "r1", "m1", state, question, 1700000000000);

    expect(to).toHaveBeenCalledWith(getRoomChannel("r1"));
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.ROUND_STARTED,
      expect.objectContaining({
        matchId: "m1",
        roundNo: 4,
        endsAt: 1700000000000,
        roundDurationMs: GAME_CONFIG.ROUND_DURATION_MS,
        question: {
          id: "q1",
          content: "What is 2+2?",
          options: ["3", "4", "5"],
          difficulty: "easy",
        },
      }),
    );
    const payload = emit.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.question).not.toHaveProperty("correctAnswer");
  });
});

describe("emitRoundEnded", () => {
  it("emits to the room channel with the standalone correctAnswer, surviving/eliminated IDs, and player results", () => {
    const { server, to, emit } = makeServer();
    const players = new Map<string, { name: string }>([
      ["p1", { name: "Alice" }],
      ["p2", { name: "Bob" }],
    ]);
    const state = { players, currentRoundNo: 7 };

    emitRoundEnded({
      server,
      roomId: "r1",
      matchId: "m1",
      state,
      correctAnswer: "4",
      survivingIds: ["p1"],
      eliminatedIds: ["p2"],
    });

    expect(to).toHaveBeenCalledWith(getRoomChannel("r1"));
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({
        matchId: "m1",
        roundNo: 7,
        correctAnswer: "4",
        survivingPlayerIds: ["p1"],
        eliminatedPlayerIds: ["p2"],
        playerResults: [{ name: "Alice" }, { name: "Bob" }],
      }),
    );
  });
});

describe("emitPlayerEliminated", () => {
  it("uses WRONG_ANSWER when the player submitted this round", () => {
    const { server, emit } = makeServer();
    const state = {
      players: new Map<string, { name: string }>(),
      currentRoundNo: 2,
    };

    emitPlayerEliminated({
      server,
      matchId: "m1",
      roomId: "r1",
      state,
      playerId: "p1",
      playerName: "Alice",
      answeredThisRound: true,
      wasOnline: true,
    });

    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({
        matchId: "m1",
        roundNo: 2,
        playerId: "p1",
        playerName: "Alice",
        reason: "WRONG_ANSWER",
      }),
    );
  });

  it("uses AFK when the player did not answer but was online", () => {
    const { server, emit } = makeServer();
    const state = {
      players: new Map<string, { name: string }>(),
      currentRoundNo: 3,
    };

    emitPlayerEliminated({
      server,
      matchId: "m1",
      roomId: "r1",
      state,
      playerId: "p1",
      playerName: "Bob",
      answeredThisRound: false,
      wasOnline: true,
    });

    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({ reason: "AFK" }),
    );
  });

  it("uses TIMEOUT when the player disconnected mid-round and never answered", () => {
    const { server, emit } = makeServer();
    const state = {
      players: new Map<string, { name: string }>(),
      currentRoundNo: 4,
    };

    emitPlayerEliminated({
      server,
      matchId: "m1",
      roomId: "r1",
      state,
      playerId: "p1",
      playerName: "Cara",
      answeredThisRound: false,
      wasOnline: false,
    });

    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({ reason: "TIMEOUT" }),
    );
  });
});

describe("emitMatchFinished", () => {
  it("emits to the room channel with winnerId, totalRounds, and players array", () => {
    const { server, to, emit } = makeServer();
    const players = new Map<string, { name: string }>([
      ["p1", { name: "Alice" }],
      ["p2", { name: "Bob" }],
    ]);
    const state = { players, currentRoundNo: 9 };

    emitMatchFinished(server, "r1", "m1", state, "p1");

    expect(to).toHaveBeenCalledWith(getRoomChannel("r1"));
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.MATCH_FINISHED,
      expect.objectContaining({
        matchId: "m1",
        winnerId: "p1",
        totalRounds: 9,
        players: [{ name: "Alice" }, { name: "Bob" }],
      }),
    );
  });

  it("emits a null winnerId when there is no winner", () => {
    const { server, emit } = makeServer();
    const state = {
      players: new Map<string, { name: string }>(),
      currentRoundNo: 1,
    };

    emitMatchFinished(server, "r1", "m1", state, null);

    expect(emit).toHaveBeenCalledWith(
      ServerEvent.MATCH_FINISHED,
      expect.objectContaining({ winnerId: null, totalRounds: 1 }),
    );
  });
});

describe("emitMatchPlayerLeft", () => {
  it("defaults the reason to LEFT when none is supplied", () => {
    const { server, to, emit } = makeServer();

    emitMatchPlayerLeft(server, "r1", "p1");

    expect(to).toHaveBeenCalledWith(getRoomChannel("r1"));
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_LEFT,
      expect.objectContaining({
        roomId: "r1",
        playerId: "p1",
        reason: "LEFT",
      }),
    );
  });

  it("honors an explicit STALE reason", () => {
    const { server, emit } = makeServer();

    emitMatchPlayerLeft(server, "r1", "p1", "STALE");

    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_LEFT,
      expect.objectContaining({ reason: "STALE" }),
    );
  });
});

describe("emitMatchDisconnected", () => {
  it("emits PLAYER_LEFT with the DISCONNECTED reason", () => {
    const { server, to, emit } = makeServer();

    emitMatchDisconnected(server, "r1", "p1");

    expect(to).toHaveBeenCalledWith(getRoomChannel("r1"));
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.PLAYER_LEFT,
      expect.objectContaining({
        roomId: "r1",
        playerId: "p1",
        reason: "DISCONNECTED",
      }),
    );
  });
});
