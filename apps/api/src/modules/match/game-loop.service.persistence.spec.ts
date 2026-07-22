import { GameLoopService } from "./game-loop.service";
import { LobbyCountdownService } from "./lobby-countdown.service";
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
  let mockEmit: any;

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
      persistStateMachine: vi.fn().mockResolvedValue("APPLIED"),
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
      findOne: vi.fn().mockResolvedValue({
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

    mockEmit = vi.fn();
    mockServer = {
      to: vi.fn().mockReturnValue({ emit: mockEmit }),
    } as unknown as Server;

    service = new GameLoopService(
      matchService,
      questionService,
      roomService,
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
      new LobbyCountdownService(roomService, createMockRedisService() as any),
      // B2c: owner by default so the fenced boundaries proceed; release/setRoundRunner no-ops.
      {
        acquireOnLaunch: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
        setRoundRunner: vi.fn(),
        assertOwnership: vi.fn().mockResolvedValue(true),
        getOwnershipSnapshot: vi.fn().mockReturnValue(undefined),
        getOwnedMatchIds: vi.fn().mockReturnValue([]),
        computeMaxSkew: vi.fn().mockResolvedValue(0),
        setRecoveryDeps: vi.fn(),
        setServer: vi.fn(),
      } as any,
      // B4a/B4b: MatchCommandService stub.
      {
        setSideEffects: vi.fn(),
        registerMatch: vi.fn().mockResolvedValue(undefined),
        deregisterMatch: vi.fn(),
        disposeStream: vi.fn().mockResolvedValue(undefined),
        forward: vi.fn().mockResolvedValue(undefined),
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

      let getRoundCallCount = 0;
      const originalGetCurrentRound =
        stateMachine.getCurrentRound.bind(stateMachine);
      const getCurrentRoundSpy = vi
        .spyOn(stateMachine, "getCurrentRound")
        .mockImplementation(() => {
          getRoundCallCount++;
          if (getRoundCallCount >= 3) {
            return null;
          }
          return originalGetCurrentRound();
        });

      // Execute endRound
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      getCurrentRoundSpy.mockRestore();

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
        .spyOn((service as any).roundRunner.logger, "error")
        .mockImplementation(() => {});

      // Simulate a DB failure inside the round-write path. The
      // service must surface the error (so the surrounding timer
      // callback logs it) and NOT advance the state machine.
      (matchService.saveRoundAndAnswers as any).mockRejectedValue(
        new Error("connection reset"),
      );

      await expect(
        (service as any).roundRunner.endRound("match-1", "room-1", mockServer),
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
      // We verify that the state machine was persisted in Redis in the ROUND_EVALUATING state.
      expect(matchService.persistStateMachine).toHaveBeenCalledTimes(1);
    });

    it("successfully recovers from ROUND_EVALUATING status if a retry occurs", async () => {
      // Simulate state machine already in ROUND_EVALUATING status with completed round status
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.submitAnswer("p2", "B", Date.now());

      // Evaluate the round to transition state machine into ROUND_EVALUATING and COMPLETED round status
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.evaluateRound();

      // Reset mock states
      vi.mocked(matchService.persistStateMachine).mockClear();
      vi.mocked(matchService.saveRoundAndAnswers).mockClear();

      // Mock questionService to support rehydration if correctAnswer is missing
      const mockQuestion = {
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      };
      vi.mocked(questionService.findOne).mockResolvedValue(mockQuestion as any);

      // Execute endRound which should enter recovery path
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // It should still call saveRoundAndAnswers
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledWith(
        "match-1",
        1,
        "q4",
        expect.arrayContaining([
          expect.objectContaining({
            userId: "p1",
            answer: "A",
            isCorrect: true,
          }),
          expect.objectContaining({
            userId: "p2",
            answer: "B",
            isCorrect: false,
          }),
        ]),
      );

      // It should transition to ROUND_RESULT and persist the final state
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);
      expect(matchService.persistStateMachine).toHaveBeenCalledTimes(2); // once during saveRoundAndAnswers success, once during ROUND_RESULT transition
    });

    it("rehydrates correctAnswer from questionService if stripped during ROUND_EVALUATING recovery", async () => {
      // Simulate state machine already in ROUND_EVALUATING status with completed round status
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.submitAnswer("p2", "B", Date.now());

      // Evaluate the round to transition state machine into ROUND_EVALUATING and COMPLETED round status
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.evaluateRound();

      // Simulate correctAnswer being stripped (e.g. for security/client filtering)
      if ((stateMachine as any).currentRound) {
        (stateMachine as any).currentRound.correctAnswer = "";
      }

      // Reset mock states
      vi.mocked(matchService.persistStateMachine).mockClear();
      vi.mocked(matchService.saveRoundAndAnswers).mockClear();

      // Mock questionService to find our question
      const mockQuestion = {
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      };
      vi.mocked(questionService.findOne).mockResolvedValue(mockQuestion as any);

      // Execute endRound which should enter recovery path
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // Assert questionService.findOne was called with the correct question id
      expect(questionService.findOne).toHaveBeenCalledWith("q4");

      // Verify saveRoundAndAnswers was called with correctly rehydrated data
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledWith(
        "match-1",
        1,
        "q4",
        expect.arrayContaining([
          expect.objectContaining({
            userId: "p1",
            answer: "A",
            isCorrect: true,
          }),
          expect.objectContaining({
            userId: "p2",
            answer: "B",
            isCorrect: false,
          }),
        ]),
      );

      // It should successfully finish recovery and transition to ROUND_RESULT
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);
    });

    it("successfully triggers checkMatchEnd recovery if match is in ROUND_RESULT status", async () => {
      // Simulate state machine already in ROUND_RESULT status
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Result recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.evaluateRound();
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      // Reset mock states
      vi.mocked(matchService.persistStateMachine).mockClear();
      vi.mocked(matchService.saveRoundAndAnswers).mockClear();
      vi.useFakeTimers();

      // Spy on checkMatchEnd to verify it is called
      const checkMatchEndSpy = vi
        .spyOn((service as any).roundRunner, "checkMatchEnd")
        .mockImplementation(async () => {});

      // Execute endRound
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // Verify that it scheduled checkMatchEnd timeout callback
      vi.advanceTimersByTime(3000);
      expect(checkMatchEndSpy).toHaveBeenCalledWith(
        "match-1",
        "room-1",
        mockServer,
      );

      vi.useRealTimers();
      checkMatchEndSpy.mockRestore();
    });

    it("should log error when checkMatchEnd throws error in timeout callback of ROUND_RESULT recovery path", async () => {
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Result recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.evaluateRound();
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      vi.useFakeTimers();

      const checkMatchEndSpy = vi
        .spyOn((service as any).roundRunner, "checkMatchEnd")
        .mockRejectedValueOnce(new Error("Timeout error"));

      const runnerLoggerSpy = vi
        .spyOn((service as any).roundRunner.logger, "error")
        .mockImplementation(() => {});

      // Execute endRound
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // Verify that it scheduled checkMatchEnd timeout callback
      await vi.runAllTimersAsync();

      expect(checkMatchEndSpy).toHaveBeenCalledWith(
        "match-1",
        "room-1",
        mockServer,
      );
      expect(runnerLoggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error in checkMatchEnd timeout callback for match match-1:",
        ),
        expect.any(Error),
      );

      vi.useRealTimers();
      checkMatchEndSpy.mockRestore();
    });

    it("rebuilds eliminatedIds from startingPlayers when roundEvaluatedEvent is missing", async () => {
      // Setup state machine to be in ROUND_EVALUATING status with completed round status
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());

      // Bypass evaluateRound so there is no ROUND_EVALUATED event to reuse.
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      const round = (stateMachine as any).currentRound;
      if (round) {
        round.status = "COMPLETED";
      }

      // Simulate the persisted post-evaluation snapshot.
      (stateMachine as any).state.survivingPlayerIds = ["p1"];
      (stateMachine as any).state.eliminatedPlayerIds = ["p2"];
      (stateMachine as any).state.players.get("p2").status =
        PlayerStatus.ELIMINATED;

      // Mock questionService to support rehydration
      vi.mocked(questionService.findOne).mockResolvedValue({
        id: "q4",
        correctAnswer: "A",
      } as any);

      // Execute endRound which should enter recovery path and rebuild the
      // eliminated ids from the persisted round snapshot.
      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // Assert that emitRoundEnded was called on the mockEmit with p2 as eliminated
      expect(mockEmit).toHaveBeenCalledWith(
        "round_ended",
        expect.objectContaining({
          eliminatedPlayerIds: ["p2"],
        }),
      );
    });

    it("does not clear startingPlayers when correctAnswer is missing during recovery", async () => {
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());

      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      const round = (stateMachine as any).currentRound;
      if (round) {
        round.status = "COMPLETED";
        round.correctAnswer = ""; // Strip correctAnswer
      }
      (stateMachine as any).state.survivingPlayerIds = ["p1"];
      (stateMachine as any).state.eliminatedPlayerIds = ["p2"];
      (stateMachine as any).state.players.get("p2").status =
        PlayerStatus.ELIMINATED;

      // Mock questionService to return null (not found)
      vi.mocked(questionService.findOne).mockResolvedValue(null as any);

      const runnerLoggerSpy = vi
        .spyOn((service as any).roundRunner.logger, "warn")
        .mockImplementation(() => {});

      await (service as any).roundRunner.endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      expect(runnerLoggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to rehydrate correctAnswer in recovery: question q4 not found in DB",
        ),
      );

      // Verify the recovery path kept the round-start roster and still
      // reconstructed the eliminated player without calling the helper.
      expect(mockEmit).toHaveBeenCalledWith(
        "round_ended",
        expect.objectContaining({
          correctAnswer: "",
          eliminatedPlayerIds: ["p2"],
        }),
      );
    });

    it("propagates error when questionService.findOne throws during recovery rehydration", async () => {
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q4",
        content: "Recovery round",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());

      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      const round = (stateMachine as any).currentRound;
      if (round) {
        round.status = "COMPLETED";
        round.correctAnswer = ""; // Strip correctAnswer
      }

      // Mock questionService to throw
      vi.mocked(questionService.findOne).mockRejectedValue(
        new Error("DB Connection Error"),
      );

      vi.spyOn((service as any).roundRunner.logger, "error").mockImplementation(
        () => {},
      );

      await expect(
        (service as any).roundRunner.endRound("match-1", "room-1", mockServer),
      ).rejects.toThrow("DB Connection Error");
    });
  });

  describe("finishMatchLoop concurrency and isMatchFinishing", () => {
    it("should prevent concurrent execution of finishMatchLoop and return correct status in isMatchFinishing", async () => {
      let resolveStateMachine: any;
      const stateMachinePromise = new Promise<any>((resolve) => {
        resolveStateMachine = resolve;
      });

      // Prepare state machine state by transitioning to COUNTDOWN so transition to FINISHED is valid
      stateMachine.transition(MatchStatus.COUNTDOWN);

      // Mock getStateMachine to return the promise
      vi.mocked(matchService.getStateMachine).mockReturnValue(
        stateMachinePromise,
      );

      const runnerLoggerSpy = vi
        .spyOn((service as any).roundRunner.logger, "warn")
        .mockImplementation(() => {});

      // Trigger first finishMatchLoop (will be suspended waiting for stateMachinePromise)
      const firstCall = (service as any).roundRunner.finishMatchLoop(
        "match-1",
        "room-1",
        mockServer,
      );

      // Verify isMatchFinishing is true
      expect((service as any).roundRunner.isMatchFinishing("match-1")).toBe(
        true,
      );

      // Trigger second finishMatchLoop concurrently
      await (service as any).roundRunner.finishMatchLoop(
        "match-1",
        "room-1",
        mockServer,
      );

      // The second caller should have been a no-op and logged a warning
      expect(runnerLoggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "finishMatchLoop already in progress for match match-1; second caller is a no-op",
        ),
      );

      // Resolve the state machine promise so the first call can finish
      resolveStateMachine(stateMachine);

      await firstCall;

      // Verify isMatchFinishing is now false
      expect((service as any).roundRunner.isMatchFinishing("match-1")).toBe(
        false,
      );
    });
  });
});
