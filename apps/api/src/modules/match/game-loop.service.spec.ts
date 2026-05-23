import { GameLoopService } from "./game-loop.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchStatus,
  PlayerStatus,
  ServerEvent,
  GAME_CONFIG,
} from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, it, expect, describe } from "vitest";

describe("GameLoopService", () => {
  let service: GameLoopService;
  let matchService: MatchService;
  let questionService: QuestionService;
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
      saveRound: vi.fn().mockResolvedValue({ id: "round-1" }),
      saveAnswer: vi.fn().mockResolvedValue({}),
      saveAnswers: vi.fn().mockResolvedValue({ count: 2 }),
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

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    service = new GameLoopService(matchService, questionService);
  });

  // === TEST 1: startMatchLoop ===
  it("should transition to COUNTDOWN and broadcast MATCH_STARTED", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Mock executeCountdown to avoid timeout issues
    const executeCountdownSpy = vi
      .spyOn(service as any, "executeCountdown")
      .mockImplementation(() => {});

    await service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    expect(stateMachine.getState().status).toBe(MatchStatus.COUNTDOWN);
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.MATCH_STARTED,
      expect.objectContaining({
        matchId: "match-1",
        status: "COUNTDOWN",
        countdownMs: GAME_CONFIG.COUNTDOWN_DURATION_MS,
      }),
    );

    // Check that executeCountdown was called
    expect(executeCountdownSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  // === TEST 2: executeCountdown ===
  it("should execute countdown and call executeRound after 5 seconds", async () => {
    vi.useFakeTimers();

    // Mock executeRound to avoid side effects
    const executeRoundSpy = vi
      .spyOn(service as any, "executeRound")
      .mockResolvedValue(undefined);

    // Call executeCountdown directly (now synchronous void)
    (service as any).executeCountdown("match-1", "room-1", mockServer);

    // Fast-forward timers
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  // === TEST 3: executeRound ===
  it("should fetch question, start round, and broadcast ROUND_STARTED", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Set state machine to COUNTDOWN state first
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // Initialize usedQuestionIds for this match
    (service as any).usedQuestionIds.set("match-1", new Set());

    // Call executeRound directly
    await (service as any).executeRound("match-1", "room-1", mockServer);

    // Check that state changed to ROUND_ACTIVE
    expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_ACTIVE);

    // Check that question was fetched
    expect(questionService.getRandom).toHaveBeenCalled();

    // Check that round was started
    const currentRound = stateMachine.getCurrentRound();
    expect(currentRound).not.toBeNull();
    expect(currentRound?.question.id).toBe("q1");

    // Check that state was persisted
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");

    // Check that ROUND_STARTED was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_STARTED,
      expect.objectContaining({
        matchId: "match-1",
        roundNo: 1,
        question: expect.objectContaining({
          id: "q1",
          content: "Test question",
          options: ["A", "B", "C", "D"],
        }),
      }),
    );

    // Check that question tracking was initialized
    const usedQuestions = (service as any).usedQuestionIds.get("match-1");
    expect(usedQuestions).toContain("q1");

    vi.useRealTimers();
  });

  // === TEST 4: endRound ===
  it("should evaluate round, save results, and broadcast events", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Set up a round in progress
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });

    // Submit answers
    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.submitAnswer("p2", "B", Date.now());

    // Call endRound directly
    await (service as any).endRound("match-1", "room-1", mockServer);

    // Check state transitions
    expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);

    // Check that round was evaluated
    expect(matchService.saveRound).toHaveBeenCalledWith("match-1", 1, "q1");
    expect(matchService.saveAnswers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          matchId: "match-1",
          roundId: "round-1",
          userId: "p1",
          answer: "A",
          isCorrect: true,
        }),
        expect.objectContaining({
          matchId: "match-1",
          roundId: "round-1",
          userId: "p2",
          answer: "B",
          isCorrect: false,
        }),
      ]),
    );

    // Check that state was persisted
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");

    // Check that events were emitted
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROUND_ENDED,
      expect.objectContaining({
        matchId: "match-1",
        roundNo: 1,
        correctAnswer: "A",
      }),
    );

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({
        matchId: "match-1",
        playerId: "p2",
        reason: "WRONG_ANSWER",
      }),
    );

    vi.useRealTimers();
  });

  // === TEST 5: checkMatchEnd - should continue ===
  it("should continue to next round when match should not end", async () => {
    vi.useFakeTimers();

    // Mock executeRound to avoid side effects
    const executeRoundSpy = vi
      .spyOn(service as any, "executeRound")
      .mockResolvedValue(undefined);

    // Set up state where match should continue (more than 1 surviving player)
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });
    stateMachine.submitAnswer("p1", "A", Date.now()); // p1 is correct
    stateMachine.submitAnswer("p2", "A", Date.now()); // p2 is also correct
    stateMachine.evaluateRound(); // Both survive

    // Call checkMatchEnd directly
    await (service as any).checkMatchEnd("match-1", "room-1", mockServer);

    // Should call executeRound for next round
    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  // === TEST 6: checkMatchEnd - should finish ===
  it("should finish match when only one player remains", async () => {
    vi.useFakeTimers();

    // Mock finishMatchLoop to avoid side effects
    const finishMatchLoopSpy = vi
      .spyOn(service as any, "finishMatchLoop")
      .mockResolvedValue(undefined);

    // Set up state where match should end (only 1 surviving player)
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });
    stateMachine.submitAnswer("p1", "A", Date.now()); // p1 is correct
    stateMachine.submitAnswer("p2", "B", Date.now()); // p2 is wrong
    stateMachine.evaluateRound(); // Only p1 survives

    // Call checkMatchEnd directly
    await (service as any).checkMatchEnd("match-1", "room-1", mockServer);

    // Should call finishMatchLoop
    expect(finishMatchLoopSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  // === TEST 7: finishMatchLoop (F1 fix verified) ===
  it("should finish match and read winnerId from state", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Setup: transition through required states
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });
    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.submitAnswer("p2", "B", Date.now());
    stateMachine.evaluateRound();

    // Call finishMatchLoop directly
    await (service as any).finishMatchLoop("match-1", "room-1", mockServer);

    // Check final state
    expect(stateMachine.getState().status).toBe(MatchStatus.FINISHED);

    // F1: finishMatch() returns void, winnerId read from state
    const winnerId = stateMachine.getState().winnerId;
    expect(winnerId).toBe("p1"); // p1 answered correctly

    // Check that match was finished in service
    expect(matchService.finishMatch).toHaveBeenCalledWith("match-1", winnerId);

    // Check that state was persisted
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");

    // Check that MATCH_FINISHED was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.MATCH_FINISHED,
      expect.objectContaining({
        matchId: "match-1",
        winnerId: "p1",
      }),
    );

    // Check cleanup
    expect((service as any).activeTimers.has("match-1")).toBeFalsy();
    expect((service as any).usedQuestionIds.has("match-1")).toBeFalsy();

    vi.useRealTimers();
  });

  // === TEST 8: cancelMatchLoop ===
  it("should clear timers and remove tracking maps", () => {
    // Initialize tracking for match
    (service as any).usedQuestionIds.set("match-1", new Set(["q1"]));
    (service as any).activeTimers.set(
      "match-1",
      new Set([setTimeout(() => {}, 1000)]),
    );

    // Call cancelMatchLoop
    service.cancelMatchLoop("match-1");

    // Check cleanup
    expect((service as any).usedQuestionIds.has("match-1")).toBeFalsy();
    expect((service as any).activeTimers.has("match-1")).toBeFalsy();
  });

  // === TEST 9: Error handling (F7) ===
  it("should end match gracefully when getRandom throws", async () => {
    vi.useFakeTimers();

    // Mock getRandom to throw an error
    (questionService.getRandom as any) = vi
      .fn()
      .mockRejectedValue(new Error("No questions"));

    // Create a fresh state machine for this test
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
    (matchService.getStateMachine as any).mockResolvedValue(stateMachine);

    const emitSpy = vi.fn();
    const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
    (mockServer.to as any).mockImplementation(toMock);

    // Initialize usedQuestionIds for this match
    (service as any).usedQuestionIds.set("match-1", new Set());

    // Start the match loop which triggers countdown and resolves immediately
    await service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    // Advance timers to trigger the error handling inside executeCountdown callback
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS + 100);

    // Match should be finished due to error
    expect(stateMachine.getState().status).toBe(MatchStatus.FINISHED);

    // Check that MATCH_FINISHED was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.MATCH_FINISHED,
      expect.objectContaining({
        matchId: "match-1",
      }),
    );

    vi.useRealTimers();
  });

  // === TEST 10: excludeIds (F2) ===
  it("should exclude used question IDs", async () => {
    vi.useFakeTimers();

    // Mock getRandom to return different questions
    const getRandomMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: "q1",
        content: "Question 1",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      })
      .mockResolvedValueOnce({
        id: "q2",
        content: "Question 2",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });

    (questionService.getRandom as any) = getRandomMock;

    (mockServer.to as any).mockReturnValue({ emit: vi.fn() });

    // Initialize usedQuestionIds for this match
    (service as any).usedQuestionIds.set("match-1", new Set());

    // First round - start from COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);
    await (service as any).executeRound("match-1", "room-1", mockServer);

    // For the second call, we need to create a new state machine to avoid transition issues
    const players2 = [
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
    const stateMachine2 = new MatchStateMachine("match-2", "room-1", players2);
    (matchService.getStateMachine as any).mockResolvedValue(stateMachine2);

    // Set up the state for the second match
    stateMachine2.transition(MatchStatus.COUNTDOWN);

    // Initialize usedQuestionIds for the second match with q1 already used
    (service as any).usedQuestionIds.set("match-2", new Set(["q1"]));

    // Call executeRound for the second match
    await (service as any).executeRound("match-2", "room-1", mockServer);

    // Check that the second call to getRandom was called with excludeIds
    expect(getRandomMock).toHaveBeenCalledTimes(2);
    expect(getRandomMock).toHaveBeenNthCalledWith(2, undefined, ["q1"]);

    vi.useRealTimers();
  });

  // === TEST 11: Early termination ===
  it("should end round early when all players answer", async () => {
    vi.useFakeTimers();

    (mockServer.to as any).mockReturnValue({ emit: vi.fn() });

    // Set up a round in progress
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });

    // Mock endRound to avoid side effects
    const endRoundSpy = vi
      .spyOn(service as any, "endRound")
      .mockResolvedValue(undefined);

    // Call checkEarlyTermination with all players having answered
    (service as any).expectedAnswers.set("match-1", 2); // Expect 2 answers
    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.submitAnswer("p2", "B", Date.now());

    await service.checkEarlyTermination(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    // Should call endRound immediately
    expect(endRoundSpy).toHaveBeenCalledWith("match-1", "room-1", mockServer);

    // Should have cleared timers
    expect((service as any).activeTimers.has("match-1")).toBeFalsy();

    vi.useRealTimers();
  });

  // === TEST 12: Disconnect handling ===
  it("should handle player disconnect, mark player disconnected/offline, and broadcast PLAYER_LEFT", async () => {
    const emitSpy = vi.fn();
    const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
    (mockServer.to as any).mockImplementation(toMock);

    // Set up state
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);

    // Make sure player exists in state machine
    const initialState = stateMachine.getState();
    const initialPlayer = initialState.players.get("p1");
    expect(initialPlayer).toBeDefined();
    expect(initialPlayer?.status).toBe(PlayerStatus.ACTIVE);
    expect(initialPlayer?.isOnline).toBe(true);

    // Call handlePlayerDisconnect
    await service.handlePlayerDisconnect(
      "match-1",
      "p1",
      mockServer as unknown as Server,
    );

    // Verify player is now disconnected and offline in actual state machine
    const updatedState = stateMachine.getState();
    expect(updatedState.players.get("p1")?.status).toBe(
      PlayerStatus.DISCONNECTED,
    );
    expect(updatedState.players.get("p1")?.isOnline).toBe(false);

    // Since getState returns a clone, we need to check if persistStateMachine was called, which indicates the state was modified
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");

    // Check that PLAYER_LEFT was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.PLAYER_LEFT,
      expect.objectContaining({
        matchId: "match-1",
        playerId: "p1",
        playerName: "Player 1",
        reason: PlayerStatus.DISCONNECTED,
      }),
    );
  });

  it("should return early and not persist or broadcast when player is not found", async () => {
    const emitSpy = vi.fn();
    const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
    (mockServer.to as any).mockImplementation(toMock);

    // Set up state
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);

    // Call handlePlayerDisconnect with unknown player ID
    await service.handlePlayerDisconnect(
      "match-1",
      "non-existent-player",
      mockServer as unknown as Server,
    );

    // Verify persistStateMachine was NOT called
    expect(matchService.persistStateMachine).not.toHaveBeenCalled();

    // Verify PLAYER_LEFT was NOT emitted
    expect(emitSpy).not.toHaveBeenCalled();
  });

  // === NEW TESTS: Race conditions & Idempotency / Error handling ===
  describe("Race conditions & Idempotency / Error handling", () => {
    it("should prevent duplicate endRound executions (idempotency guard)", async () => {
      // Set up a round in progress
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q1",
        content: "Test question",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });

      // Submit answers
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.submitAnswer("p2", "A", Date.now());

      // 1. Call endRound first time
      const firstCall = (service as any).endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // 2. Call endRound immediately a second time while first is running
      // Since JavaScript is single-threaded, if we call endRound again concurrently,
      // it should hit the `endingRounds` lock check and return early.
      const secondCall = (service as any).endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      await Promise.all([firstCall, secondCall]);

      // State machine should only have evaluated and saved once
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);
      expect(matchService.saveRound).toHaveBeenCalledTimes(1);
    });

    it("should bypass endRound if match status is not ROUND_ACTIVE or round is not ACTIVE", async () => {
      // Set up a state other than ROUND_ACTIVE (e.g. finished)
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.FINISHED);

      // Spy on transition and evaluateRound
      const transitionSpy = vi.spyOn(stateMachine, "transition");
      const evaluateSpy = vi.spyOn(stateMachine, "evaluateRound");

      // Call endRound directly
      await (service as any).endRound("match-1", "room-1", mockServer);

      // Since the match status is FINISHED, it should bypass transition and evaluation
      expect(transitionSpy).not.toHaveBeenCalled();
      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("should catch and log errors in timeout callbacks", async () => {
      vi.useFakeTimers();

      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

      // Mock endRound and checkMatchEnd to throw errors
      const endRoundSpy = vi
        .spyOn(service as any, "endRound")
        .mockRejectedValue(new Error("endRound failure"));
      const checkMatchEndSpy = vi
        .spyOn(service as any, "checkMatchEnd")
        .mockRejectedValue(new Error("checkMatchEnd failure"));

      // 1. Trigger the executeRound timeout
      stateMachine.transition(MatchStatus.COUNTDOWN);
      (service as any).usedQuestionIds.set("match-1", new Set());
      await (service as any).executeRound("match-1", "room-1", mockServer);

      // Fast forward to executeRound's 15s timeout
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error in endRound timeout callback for match match-1:",
        ),
        expect.any(Error),
      );

      // Clear logger spies and mocks
      loggerErrorSpy.mockClear();

      // Reset mock endRound so we can call it successfully to schedule the 3s checkMatchEnd timer
      endRoundSpy.mockRestore();
      const loggerErrorSpy2 = vi.spyOn((service as any).logger, "error");

      // Re-mock saveRound and saveAnswers for endRound
      (matchService.saveRound as any).mockResolvedValue({ id: "round-1" });
      (matchService.saveAnswers as any).mockResolvedValue({ count: 2 });

      // Set up state for endRound to succeed
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
      const testStateMachine = new MatchStateMachine(
        "match-2",
        "room-1",
        players,
      );
      testStateMachine.transition(MatchStatus.COUNTDOWN);
      testStateMachine.transition(MatchStatus.ROUND_ACTIVE);
      testStateMachine.startRound({
        id: "q1",
        content: "Test question",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });
      (matchService.getStateMachine as any).mockResolvedValue(testStateMachine);

      // Call endRound directly, which will schedule the 3s checkMatchEnd timer
      await (service as any).endRound("match-2", "room-1", mockServer);

      // Fast forward to checkMatchEnd's 3s timeout
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.RESULT_DISPLAY_MS);

      expect(loggerErrorSpy2).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error in checkMatchEnd timeout callback for match match-2:",
        ),
        expect.any(Error),
      );

      vi.useRealTimers();
      checkMatchEndSpy.mockRestore();
    });

    it("should catch and log error if executeRound throws in executeCountdown timer callback", async () => {
      vi.useFakeTimers();

      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

      // Mock executeRound to throw/reject
      vi.spyOn(service as any, "executeRound").mockRejectedValue(
        new Error("countdown round failure"),
      );

      // Call executeCountdown directly
      (service as any).executeCountdown("match-1", "room-1", mockServer);

      // Fast-forward timers
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Failed to execute round for match match-1:",
        expect.any(Error),
      );

      vi.useRealTimers();
    });
  });

  describe("Missing Coverage (Null Guards & Optional Params)", () => {
    it("should return early in startMatchLoop if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

      await service.startMatchLoop("match-nonexistent", "room-1", mockServer);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "State machine not found for match match-nonexistent",
      );
    });

    it("should return early in executeRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const startRoundSpy = vi.spyOn(stateMachine, "startRound");

      await (service as any).executeRound(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(startRoundSpy).not.toHaveBeenCalled();
    });

    it("should return early in endRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const evaluateSpy = vi.spyOn(stateMachine, "evaluateRound");

      await (service as any).endRound(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("should return early in checkMatchEnd if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const shouldEndSpy = vi.spyOn(stateMachine, "shouldEndMatch");

      await (service as any).checkMatchEnd(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(shouldEndSpy).not.toHaveBeenCalled();
    });

    it("should return early in finishMatchLoop if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const transitionSpy = vi.spyOn(stateMachine, "transition");

      await (service as any).finishMatchLoop(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(transitionSpy).not.toHaveBeenCalled();
    });

    it("should return early in handlePlayerDisconnect if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const loggerWarnSpy = vi.spyOn((service as any).logger, "warn");

      await service.handlePlayerDisconnect(
        "match-nonexistent",
        "p1",
        mockServer,
      );

      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it("should return early in checkEarlyTermination if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(null);
      const getRoundSpy = vi.spyOn(stateMachine, "getCurrentRound");

      await service.checkEarlyTermination(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(getRoundSpy).not.toHaveBeenCalled();
    });

    it("should handle optional serverOrContext parameter in finishMatchLoop", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(stateMachine);
      const loggerDebugSpy = vi.spyOn((service as any).logger, "debug");

      // Setup state machine so finishMatch succeeds
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q1",
        content: "Q",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });
      stateMachine.submitAnswer("p1", "A", Date.now());
      stateMachine.submitAnswer("p2", "B", Date.now());
      stateMachine.evaluateRound();

      const contextObj = { customKey: "customValue" };
      await (service as any).finishMatchLoop(
        "match-1",
        "room-1",
        mockServer,
        contextObj,
      );

      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'finishMatchLoop called with context: {"customKey":"customValue"}',
        ),
      );
    });
  });
});
