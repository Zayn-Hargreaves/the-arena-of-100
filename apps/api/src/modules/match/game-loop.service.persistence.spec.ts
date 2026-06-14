import { GameLoopService } from "./game-loop.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { MatchStateMachine } from "@arena/game-core";
import { MatchStatus, PlayerStatus } from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, afterEach, it, expect, describe } from "vitest";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";

describe("GameLoopService Persistence", () => {
  let service: GameLoopService;
  let matchService: MatchService;
  let questionService: QuestionService;
  let roomService: RoomService;
  let mockServer: Server;
  let stateMachine: MatchStateMachine;

  beforeEach(() => {
    // Create real state machine with test players
    const players = [
      {
        id: "p1",
        name: "Player 1",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
      {
        id: "p2",
        name: "Player 2",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
    ];
    stateMachine = new MatchStateMachine("match-1", "room-1", players);

    matchService = {
      getStateMachine: vi.fn().mockResolvedValue(stateMachine),
      persistStateMachine: vi.fn().mockResolvedValue(undefined),
      finishMatch: vi.fn().mockResolvedValue({}),
      // H2-style endRound fix: round + answers are now persisted
      // atomically via a single $transaction-backed call.
      saveRoundAndAnswers: vi
        .fn()
        .mockResolvedValue({ id: "round-record-123" }),
    } as unknown as MatchService;

    questionService = {
      getRandom: vi.fn().mockResolvedValue({
        id: "q1",
        content: "Test question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      }),
    } as unknown as QuestionService;

    roomService = {
      updateRoomStatus: vi.fn().mockResolvedValue({}),
      getRoom: vi.fn(),
    } as unknown as RoomService;

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    service = new GameLoopService(
      matchService,
      questionService,
      roomService,
      createMockRedisService() as any,
      // B3 fix: GameLoopService now takes a PrismaService for the
      // `SELECT ... FOR UPDATE` transaction in `launchRoomMatch`.
      // The persistence suite does not exercise that path, so a
      // no-op mock with a stub tx client is sufficient.
      {
        $transaction: vi.fn().mockImplementation(
          async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
            fn({
              $queryRaw: vi.fn().mockResolvedValue([]),
              room: { update: vi.fn().mockResolvedValue({}) },
            }),
        ),
        $queryRaw: vi.fn().mockResolvedValue([]),
      } as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("endRound persistence", () => {
    it("should save round and answers with correct parameters", async () => {
      // Setup: transition through required states and submit answers
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q1",
        content: "Test question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });

      // Submit answers from players
      const now = Date.now();
      stateMachine.submitAnswer("p1", "A", now);
      stateMachine.submitAnswer("p2", "B", now);

      // Execute endRound
      await (service as any).endRound("match-1", "room-1", mockServer);

      // Verify saveRoundAndAnswers was called with the round metadata
      // and the per-player answer map. The answer rows no longer
      // carry roundId at the call site — it's stamped inside the
      // transaction when the round row is created.
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledWith(
        "match-1", // matchId
        1, // roundNo (first round)
        "q1", // questionId
        expect.arrayContaining([
          expect.objectContaining({
            userId: "p1",
            answer: "A",
            isCorrect: true,
            responseTimeMs: expect.any(Number),
          }),
          expect.objectContaining({
            userId: "p2",
            answer: "B",
            isCorrect: false,
            responseTimeMs: expect.any(Number),
          }),
        ]),
      );
    });

    it("persists round + answers in a single atomic transaction", async () => {
      // Regression test: a partial failure on the answer batch must
      // NOT leave a round row in the DB. Previously the two awaits
      // were separate; a saveAnswers throw after saveRound committed
      // stranded the match in ROUND_EVALUATING and tripped P2002 on
      // the next retry.
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q3",
        content: "Atomic round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());

      const loggerSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});

      // Simulate a DB failure inside the round-write path. The
      // service must surface the error (so the surrounding timer
      // callback logs it) and NOT advance the state machine.
      (matchService.saveRoundAndAnswers as any).mockRejectedValue(
        new Error("connection reset"),
      );

      await expect(
        (service as any).endRound("match-1", "room-1", mockServer),
      ).rejects.toThrow("connection reset");

      // Verify logger.error was called with the expected error message
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "H3: endRound DB persistence failed for match match-1 round 1",
        ),
        expect.any(Error),
      );

      // The state machine was transitioned to ROUND_EVALUATING
      // BEFORE the DB call (H3 ordering). It must NOT have been
      // advanced to ROUND_RESULT — that would orphan a future
      // retry.
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_EVALUATING);
      // persistStateMachine must NOT have been called either —
      // the next timer needs to see ROUND_EVALUATING in Redis to
      // decide whether to retry.
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });
  });
});
