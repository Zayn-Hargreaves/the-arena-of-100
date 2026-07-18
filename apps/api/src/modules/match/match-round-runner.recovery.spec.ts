import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  ServerEvent,
} from "@arena/shared";
import { MatchRoundRunner } from "./match-round-runner";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";

type RecoveryEvent = {
  type: string;
  payload?: unknown;
  timestamp: number;
};

function buildRecoveryContext(events: RecoveryEvent[]) {
  const state = {
    id: "match-1",
    roomId: "room-1",
    status: MatchStatus.ROUND_EVALUATING,
    currentRoundNo: 1,
    totalRounds: GAME_CONFIG.MAX_ROUNDS,
    players: new Map([
      [
        "p1",
        {
          id: "p1",
          name: "Player 1",
          status: PlayerStatus.ACTIVE,
          score: 0,
          totalResponseTimeMs: 100,
          correctAnswers: 1,
          isOnline: true,
        },
      ],
      [
        "p2",
        {
          id: "p2",
          name: "Player 2",
          status: PlayerStatus.ELIMINATED,
          score: 0,
          totalResponseTimeMs: 0,
          correctAnswers: 0,
          isOnline: true,
        },
      ],
    ]),
    survivingPlayerIds: ["p1"],
    eliminatedPlayerIds: ["p2"],
    winnerId: null,
    startedAt: 100,
    endedAt: null,
  };

  const round = {
    matchId: "match-1",
    roundNo: 1,
    question: {
      id: "q1",
      content: "Question",
      options: ["A", "B"],
      difficulty: "MEDIUM",
    },
    startedAt: 100,
    endsAt: 1000,
    answers: new Map([
      [
        "p1",
        {
          answer: "A",
          isCorrect: true,
          responseTimeMs: 100,
          submittedAt: 200,
          submissionId: "sub-1",
        },
      ],
      [
        "p2",
        {
          answer: "B",
          isCorrect: false,
          responseTimeMs: 150,
          submittedAt: 250,
          submissionId: "sub-2",
        },
      ],
    ]),
    status: "COMPLETED" as const,
    correctAnswer: "A",
    startingPlayers: ["p1", "p2"],
  };

  const stateMachine = {
    getState: vi.fn(() => state),
    getCurrentRound: vi.fn(() => round),
    getEventLog: vi.fn(() => events),
    transition: vi.fn(),
  };

  return { state, round, stateMachine };
}

function buildRunner(
  stateMachine: ReturnType<typeof buildRecoveryContext>["stateMachine"],
  questionService: QuestionService,
  roomService: RoomService,
) {
  const matchService = {
    getStateMachine: vi.fn().mockResolvedValue(stateMachine),
    persistStateMachine: vi.fn().mockResolvedValue("APPLIED"),
    saveRoundAndAnswers: vi.fn().mockResolvedValue({ id: "round-1" }),
  } as unknown as MatchService;

  return {
    runner: new MatchRoundRunner(
      matchService,
      questionService,
      roomService,
      // B2c: owner by default so the fenced boundaries proceed.
      {
        assertOwnership: vi.fn().mockResolvedValue(true),
      } as unknown as import("./match-ownership.service").MatchOwnershipService,
    ),
    matchService,
  };
}

describe("MatchRoundRunner recovery event validation", () => {
  let emitSpy: ReturnType<typeof vi.fn>;
  let mockServer: Server;
  let questionService: QuestionService;
  let roomService: RoomService;

  beforeEach(() => {
    vi.useFakeTimers();
    emitSpy = vi.fn();
    mockServer = {
      to: vi.fn().mockReturnValue({ emit: emitSpy }),
    } as unknown as Server;

    questionService = {
      findOne: vi.fn(),
    } as unknown as QuestionService;

    roomService = {
      getRoom: vi.fn().mockResolvedValue({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.IN_GAME,
        currentMatchId: "match-1",
      }),
    } as unknown as RoomService;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts exactly one valid ROUND_EVALUATED event for the round", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p2"] },
        timestamp: 1,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });

  it("falls back to recomputing eliminations when multiple ROUND_EVALUATED events exist for the round", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p1"] },
        timestamp: 1,
      },
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p2"] },
        timestamp: 2,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });

  it("falls back to recomputing eliminations when ROUND_EVALUATED event disagrees with round answers", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p1"] },
        timestamp: 1,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });

  it("falls back to recomputing eliminations when ROUND_EVALUATED contains duplicate IDs", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p2", "p2"] },
        timestamp: 1,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });

  it("falls back to recomputing eliminations when ROUND_EVALUATED contains a non-string ID", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: [123, "p2"] },
        timestamp: 1,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });

  it("falls back to recomputing eliminations when ROUND_EVALUATED contains IDs outside the match roster", async () => {
    const { stateMachine } = buildRecoveryContext([
      {
        type: "ROUND_EVALUATED",
        payload: { roundNo: 1, eliminatedIds: ["p3"] },
        timestamp: 1,
      },
    ]);
    const { runner } = buildRunner(stateMachine, questionService, roomService);

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({ eliminatedPlayerIds: ["p2"] }),
    );
  });
});
