import { GameLoopService, COUNTDOWN_INDEX_KEY } from "./game-loop.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  ServerEvent,
  GAME_CONFIG,
  ErrorCode,
} from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, it, expect, describe } from "vitest";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";

describe("GameLoopService", () => {
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

    roomService = {
      getRoom: vi.fn().mockResolvedValue({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      }),
      updateRoomStatus: vi.fn().mockResolvedValue({}),
    } as unknown as RoomService;

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    service = new GameLoopService(
      matchService,
      questionService,
      roomService,
      createMockRedisService() as any,
    );
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

    expect(vi.mocked(roomService.updateRoomStatus)).toHaveBeenCalledWith(
      "room-1",
      RoomStatus.IN_GAME,
      "match-1",
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

  it("starts public room countdown when enough players join", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });
    const launchSpy = vi
      .spyOn(service as any, "launchRoomMatch")
      .mockResolvedValue({ id: "m1" });

    const result = await service.maybeStartPublicCountdown(
      "room-1",
      mockServer,
    );

    expect(result).not.toBeNull();
    expect(vi.mocked(roomService.updateRoomStatus)).toHaveBeenCalledWith(
      "room-1",
      RoomStatus.COUNTDOWN,
    );

    await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

    expect(launchSpy).toHaveBeenCalledWith("room-1", mockServer, {
      isAutoStart: true,
    });

    vi.useRealTimers();
  });

  it("cancels room countdown when players drop below minimum", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });
    vi.mocked(roomService.getRoom)
      .mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any)
      .mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.COUNTDOWN,
        currentMatchId: null,
        players: [{ userId: "p1" }],
      } as any);

    await service.maybeStartPublicCountdown("room-1", mockServer);
    await service.handleRoomPlayerLeft("room-1", mockServer);

    expect(vi.mocked(roomService.updateRoomStatus)).toHaveBeenCalledWith(
      "room-1",
      RoomStatus.WAITING,
    );
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      expect.objectContaining({ reason: "PLAYER_LEFT" }),
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
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

      await service.startMatchLoop("match-nonexistent", "room-1", mockServer);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "State machine not found for match match-nonexistent",
      );
    });

    it("should return early in executeRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const startRoundSpy = vi.spyOn(stateMachine, "startRound");

      await (service as any).executeRound(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(startRoundSpy).not.toHaveBeenCalled();
    });

    it("should return early in endRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const evaluateSpy = vi.spyOn(stateMachine, "evaluateRound");

      await (service as any).endRound(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("should return early in checkMatchEnd if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const shouldEndSpy = vi.spyOn(stateMachine, "shouldEndMatch");

      await (service as any).checkMatchEnd(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(shouldEndSpy).not.toHaveBeenCalled();
    });

    it("should return early in finishMatchLoop if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const transitionSpy = vi.spyOn(stateMachine, "transition");

      await (service as any).finishMatchLoop(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(transitionSpy).not.toHaveBeenCalled();
    });

    it("should return early in handlePlayerDisconnect if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const loggerWarnSpy = vi.spyOn((service as any).logger, "warn");

      await service.handlePlayerDisconnect(
        "match-nonexistent",
        "p1",
        mockServer,
      );

      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it("should return early in checkEarlyTermination if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
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

  // ============================================================
  // Lobby Countdown Recovery, Launch & Match Finish
  // ============================================================
  describe("Lobby Countdown Recovery, Launch & Match Finish", () => {
    // The recovery / countdown-arm / launch paths are async + timer-heavy
    // and manipulate Redis keys, so we build a fresh GameLoopService per
    // test (matching how the service is wired once per Nest process).
    function buildService(
      redisOverrides: { smembers?: unknown; get?: unknown } = {},
    ) {
      const redis = createMockRedisService() as any;
      // Wrap the plain-function `multi()` in a spy so tests can assert
      // that the persistence/clear paths were taken.
      const multiSpy = vi.fn(() => ({
        set: () => ({ sadd: () => ({ exec: () => Promise.resolve([]) }) }),
        del: () => ({ srem: () => ({ exec: () => Promise.resolve([]) }) }),
        sadd: () => ({ exec: () => Promise.resolve([]) }),
        srem: () => ({ exec: () => Promise.resolve([]) }),
        exec: () => Promise.resolve([]),
      }));
      vi.spyOn(redis.getClient(), "multi").mockImplementation(
        multiSpy as unknown as () => unknown,
      );
      // Allow per-test override of the smembers/get return values on the
      // shared mock client (createMockRedisService reuses the same client
      // across getClient() calls so the override is what recovery sees).
      if (redisOverrides.smembers !== undefined) {
        vi.mocked(redis.getClient().smembers).mockResolvedValueOnce(
          redisOverrides.smembers as string[],
        );
      }
      if (redisOverrides.get !== undefined) {
        vi.mocked(redis.getClient().get).mockResolvedValueOnce(
          redisOverrides.get as string | null,
        );
      }
      const svc = new GameLoopService(
        matchService,
        questionService,
        roomService,
        redis,
      );
      return { svc, redis, multiSpy };
    }

    // ---- getCountdownEnd ----
    describe("getCountdownEnd", () => {
      it("returns null when no countdown is active for the room", () => {
        expect(service.getCountdownEnd("r1")).toBeNull();
      });

      it("returns the recorded countdownEndsAt for an active countdown", () => {
        const endsAt = Date.now() + 10_000;
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: endsAt,
        });
        expect(service.getCountdownEnd("r1")).toBe(endsAt);
      });
    });

    // ---- armLobbyCountdownTimer (no server) ----
    describe("armLobbyCountdownTimer (private)", () => {
      it("deletes the in-memory slot and clears Redis when no server is available", async () => {
        const { svc, multiSpy } = buildService();
        // No setServer() call → server is undefined
        (svc as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });

        (svc as any).armLobbyCountdownTimer("r1", Date.now() + 5000);

        expect((svc as any).lobbyCountdowns.has("r1")).toBe(false);
        // clearPersistedCountdown fires the multi() chain
        expect(multiSpy).toHaveBeenCalled();
      });

      it("arms a timer that triggers launchRoomMatch when the caller supplies a server", async () => {
        vi.useFakeTimers();
        const { svc } = buildService();
        const launchSpy = vi
          .spyOn(svc as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });

        (svc as any).armLobbyCountdownTimer(
          "r1",
          Date.now() + 5000,
          mockServer as unknown as Server,
        );

        expect((svc as any).lobbyCountdowns.has("r1")).toBe(true);

        await vi.advanceTimersByTimeAsync(5000);

        expect(launchSpy).toHaveBeenCalledWith("r1", mockServer, {
          isAutoStart: true,
        });
        vi.useRealTimers();
      });
    });

    // ---- handleRoomPlayerLeft ----
    describe("handleRoomPlayerLeft", () => {
      it("is a no-op when no countdown is active for the room", async () => {
        await service.handleRoomPlayerLeft("r1", mockServer);
        expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
        expect(mockServer.to).not.toHaveBeenCalled();
      });

      it("is a no-op when the room is not in COUNTDOWN status", async () => {
        // Pre-arm a countdown so the entry exists
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          players: [{ userId: "p1" }],
        } as any);

        await service.handleRoomPlayerLeft("r1", mockServer);

        expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
        expect(mockServer.to).not.toHaveBeenCalled();
      });

      it("is a no-op when the room still has at least MIN_PLAYERS_TO_START players", async () => {
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.COUNTDOWN,
          players: [{ userId: "p1" }, { userId: "p2" }, { userId: "p3" }],
        } as any);

        await service.handleRoomPlayerLeft("r1", mockServer);

        expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
        expect(mockServer.to).not.toHaveBeenCalled();
      });

      it("cancels the countdown, updates status, and emits ROOM_COUNTDOWN_CANCELLED + ROOM_STATUS_UPDATED", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.COUNTDOWN,
          players: [{ userId: "p1" }], // below MIN
        } as any);

        await service.handleRoomPlayerLeft("r1", mockServer);

        expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
          "r1",
          RoomStatus.WAITING,
        );
        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_COUNTDOWN_CANCELLED,
          expect.objectContaining({
            roomId: "r1",
            roomStatus: RoomStatus.WAITING,
            reason: "PLAYER_LEFT",
          }),
        );
        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_STATUS_UPDATED,
          expect.objectContaining({
            roomId: "r1",
            roomStatus: RoomStatus.WAITING,
          }),
        );
        expect((service as any).lobbyCountdowns.has("r1")).toBe(false);
      });
    });

    // ---- forceStartRoomMatch ----
    describe("forceStartRoomMatch", () => {
      it("delegates to launchRoomMatch with isAutoStart=false", async () => {
        const launchSpy = vi
          .spyOn(service as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });

        const result = await service.forceStartRoomMatch("r1", mockServer);

        expect(launchSpy).toHaveBeenCalledWith("r1", mockServer, {
          isAutoStart: false,
        });
        expect(result).toEqual({ id: "m1" });
      });
    });

    // ---- launchRoomMatch ----
    describe("launchRoomMatch", () => {
      it("throws ROOM_ALREADY_STARTED when the room is in a non-launchable status", async () => {
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.IN_GAME,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
      });

      it("throws NOT_ENOUGH_PLAYERS and emits ROOM_COUNTDOWN_CANCELLED when autoStart && below MIN", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.COUNTDOWN,
          players: [{ userId: "p1" }], // below MIN
        } as any);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: true,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_ENOUGH_PLAYERS });

        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_COUNTDOWN_CANCELLED,
          expect.objectContaining({
            roomId: "r1",
            reason: "NOT_ENOUGH_PLAYERS",
          }),
        );
        // room was reset to WAITING
        expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
          "r1",
          RoomStatus.WAITING,
        );
      });

      it("throws NOT_ENOUGH_PLAYERS WITHOUT emitting a cancel event when NOT autoStart && below MIN", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          players: [{ userId: "p1" }], // below MIN
        } as any);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_ENOUGH_PLAYERS });

        // No countdown cancelled event should be emitted on a manual
        // forceStart with too few players (room was already WAITING)
        const cancelEmits = emitSpy.mock.calls.filter(
          (call) => call[0] === ServerEvent.ROOM_COUNTDOWN_CANCELLED,
        );
        expect(cancelEmits).toHaveLength(0);
      });

      it("clears an existing countdown from the lobby before proceeding", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        // Seed an active countdown
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        vi.mocked(roomService.getRoom)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.COUNTDOWN,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.COUNTDOWN,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any);
        (matchService.createMatch as any) = vi
          .fn()
          .mockResolvedValue({ id: "m1" });
        // Stub startMatchLoop to avoid the full round loop
        vi.spyOn(service as any, "startMatchLoop").mockResolvedValue(undefined);

        await (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: true,
        });

        expect((service as any).lobbyCountdowns.has("r1")).toBe(false);
      });

      it("happy path: updates status to STARTING, creates the match, and starts the loop", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.WAITING,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.WAITING,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any);
        (matchService.createMatch as any) = vi
          .fn()
          .mockResolvedValue({ id: "m1" });
        const startLoopSpy = vi
          .spyOn(service as any, "startMatchLoop")
          .mockResolvedValue(undefined);

        const match = await (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        });

        expect(match).toEqual({ id: "m1" });
        expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
          "r1",
          RoomStatus.STARTING,
        );
        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.MATCH_STARTING,
          expect.objectContaining({ matchId: "m1" }),
        );
        expect(startLoopSpy).toHaveBeenCalledWith("m1", "r1", mockServer);
      });

      it("rolls back to WAITING and re-broadcasts ROOM_STATUS_UPDATED if createMatch throws", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.WAITING,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.WAITING,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any);
        (matchService.createMatch as any) = vi
          .fn()
          .mockRejectedValue(new Error("db boom"));

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("db boom");

        expect(roomService.updateRoomStatus).toHaveBeenLastCalledWith(
          "r1",
          RoomStatus.WAITING,
        );
        const rollback = emitSpy.mock.calls.find(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollback).toBeDefined();
      });
    });

    // ---- onModuleInit recovery ----
    describe("onModuleInit (lobby countdown recovery)", () => {
      it("is a no-op when the countdowns set is empty", async () => {
        const { svc } = buildService({ smembers: [] });
        await svc.onModuleInit();
        // No further calls into Redis beyond the initial SMEMBERS
        expect(svc).toBeDefined();
      });

      it("removes a room from the index when its payload key is missing", async () => {
        const { svc, redis } = buildService({
          smembers: ["rMissing"],
        });
        // get() returns null by default → direct srem path (no multi needed)
        const sremSpy = redis.getClient().srem;
        await svc.onModuleInit();
        expect(sremSpy).toHaveBeenCalledWith(COUNTDOWN_INDEX_KEY, "rMissing");
      });

      it("clears the persisted entry when the stored countdownEndsAt is unparseable", async () => {
        const { svc, multiSpy } = buildService({
          smembers: ["rBad"],
          get: "not-a-number",
        });
        await svc.onModuleInit();
        // clearPersistedCountdown runs the multi() chain
        expect(multiSpy).toHaveBeenCalled();
      });

      it("re-arms a timer for a future countdown (uses the injected server)", async () => {
        vi.useFakeTimers();
        const futureEnd = Date.now() + 60_000;
        const { svc } = buildService({
          smembers: ["rFuture"],
          get: String(futureEnd),
        });
        // Inject a server so the arm path can use it
        const launchSpy = vi
          .spyOn(svc as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });
        (svc as any).setServer(mockServer as unknown as Server);

        await svc.onModuleInit();

        // Countdown is now armed in-memory
        expect((svc as any).lobbyCountdowns.has("rFuture")).toBe(true);
        // Advancing past the future end fires launchRoomMatch
        await vi.advanceTimersByTimeAsync(60_000);
        expect(launchSpy).toHaveBeenCalledWith("rFuture", mockServer, {
          isAutoStart: true,
        });
        vi.useRealTimers();
      });

      it("launches immediately when the recovered countdown already expired and a server is set", async () => {
        const pastEnd = Date.now() - 1000;
        const { svc } = buildService({
          smembers: ["rExpired"],
          get: String(pastEnd),
        });
        const launchSpy = vi
          .spyOn(svc as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });
        (svc as any).setServer(mockServer as unknown as Server);

        await svc.onModuleInit();
        // Give the void promise chain a microtask to flush
        await Promise.resolve();

        expect(launchSpy).toHaveBeenCalledWith("rExpired", mockServer, {
          isAutoStart: true,
        });
      });

      it("clears the persisted entry when the recovered countdown expired and no server is wired up", async () => {
        const pastEnd = Date.now() - 1000;
        const { svc, multiSpy } = buildService({
          smembers: ["rExpiredNoServer"],
          get: String(pastEnd),
        });
        // No setServer call → server is undefined

        await svc.onModuleInit();
        // Allow the fire-and-forget clearPersistedCountdown to run
        await Promise.resolve();
        await Promise.resolve();

        // The clear path used multi() (or directly .srem)
        expect(multiSpy).toHaveBeenCalled();
      });

      it("logs and continues when a per-room recovery error is thrown", async () => {
        const { svc, redis } = buildService({
          smembers: ["rBoom"],
        });
        // Make the per-room get() throw
        vi.mocked(redis.getClient().get).mockRejectedValueOnce(
          new Error("redis timeout"),
        );
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await svc.onModuleInit();

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("rBoom"),
          expect.any(Error),
        );
      });

      it("resets the recoveryInFlight guard even if the top-level recovery throws", async () => {
        const { svc, redis } = buildService();
        // Make SMEMBERS itself reject
        vi.mocked(redis.getClient().smembers).mockRejectedValueOnce(
          new Error("top-level boom"),
        );
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await svc.onModuleInit();

        expect(errorSpy).toHaveBeenCalledWith(
          "Lobby countdown recovery failed:",
          expect.any(Error),
        );
        // Guard must be reset so a later invocation can run
        expect((svc as any).recoveryInFlight).toBe(false);
      });
    });

    // ---- maybeStartPublicCountdown additional paths ----
    describe("maybeStartPublicCountdown (additional paths)", () => {
      it("returns null for a PRIVATE room", async () => {
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          type: "PRIVATE",
          status: RoomStatus.WAITING,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        const result = await service.maybeStartPublicCountdown(
          "r1",
          mockServer,
        );
        expect(result).toBeNull();
      });

      it("returns null when the room is not in WAITING status", async () => {
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          type: "PUBLIC",
          status: RoomStatus.IN_GAME,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        const result = await service.maybeStartPublicCountdown(
          "r1",
          mockServer,
        );
        expect(result).toBeNull();
      });

      it("returns null when there are fewer than MIN_PLAYERS_TO_START players", async () => {
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          type: "PUBLIC",
          status: RoomStatus.WAITING,
          players: [{ userId: "p1" }],
        } as any);

        const result = await service.maybeStartPublicCountdown(
          "r1",
          mockServer,
        );
        expect(result).toBeNull();
      });

      it("returns the existing countdown entry when one is already armed", async () => {
        const endsAt = Date.now() + 30_000;
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: endsAt,
        });

        const result = await service.maybeStartPublicCountdown(
          "r1",
          mockServer,
        );

        // The service returns the whole entry (timer + countdownEndsAt);
        // we only care that the endsAt we stored is what comes back.
        expect(result?.countdownEndsAt).toBe(endsAt);
        // updateRoomStatus must NOT be called a second time
        expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
      });
    });

    // ============================================================
    // Error & edge-case paths in lobby countdown persistence
    // (coverage gaps flagged by Codecov on PR #38)
    // ============================================================
    describe("Lobby countdown error & edge-case paths", () => {
      // Helper: build a service whose redis client throws on the next
      // `multi()` invocation. Used to exercise the `catch` blocks in
      // `persistLobbyCountdown` and `clearPersistedCountdown` without
      // needing a real Redis.
      function buildServiceWithFailingMulti(throwFrom: "set" | "del") {
        const redis = createMockRedisService() as any;
        const failingExec = vi.fn().mockRejectedValue(new Error("redis down"));
        const multiSpy = vi.fn(() => {
          const mockMulti: any = {};
          mockMulti.set = vi.fn().mockReturnValue(mockMulti);
          mockMulti.del = vi.fn().mockReturnValue(mockMulti);
          mockMulti.sadd = vi.fn().mockReturnValue(mockMulti);
          mockMulti.srem = vi.fn().mockReturnValue(mockMulti);
          mockMulti.exec = vi.fn().mockImplementation(() => {
            if (throwFrom === "set" && mockMulti.set.mock.calls.length > 0) {
              return failingExec();
            }
            if (throwFrom === "del" && mockMulti.del.mock.calls.length > 0) {
              return failingExec();
            }
            return Promise.resolve([]);
          });
          return mockMulti;
        });
        vi.spyOn(redis.getClient(), "multi").mockImplementation(
          multiSpy as unknown as () => unknown,
        );
        const svc = new GameLoopService(
          matchService,
          questionService,
          roomService,
          redis,
        );
        return { svc, redis, failingExec, multiSpy };
      }

      it("logs and swallows errors thrown by persistLobbyCountdown (redis SET chain fails)", async () => {
        const { svc, multiSpy } = buildServiceWithFailingMulti("set");
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await (svc as any).persistLobbyCountdown("r1", Date.now() + 5000);

        expect(multiSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          "Failed to persist lobby countdown for room r1:",
          expect.any(Error),
        );
      });

      it("logs and swallows errors thrown by clearPersistedCountdown (redis DEL chain fails)", async () => {
        const { svc, multiSpy } = buildServiceWithFailingMulti("del");
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        await (svc as any).clearPersistedCountdown("r1");

        expect(multiSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Failed to clear persisted countdown for room r1: redis down",
          ),
        );
      });

      it("maybeStartPublicCountdown rolls back the in-memory slot, fires clearPersistedCountdown, and rethrows when updateRoomStatus fails", async () => {
        vi.useFakeTimers();
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
          new Error("db write failed"),
        );
        const errorSpy = vi.spyOn((service as any).logger, "error");
        // The catch block fires void this.clearPersistedCountdown(roomId) —
        // spy on the redis client's multi() so we can assert the cleanup
        // pipeline runs (and therefore the dead persisted entry is wiped
        // so a retry can re-arm cleanly).
        const multiSpy = vi.spyOn((service as any).redis.getClient(), "multi");

        await expect(
          service.maybeStartPublicCountdown("r1", mockServer),
        ).rejects.toThrow("db write failed");

        // In-memory countdown slot must be cleared so a retry can re-arm
        expect((service as any).lobbyCountdowns.has("r1")).toBe(false);
        // The cleanup pipeline (DEL + SREM) must have been queued to wipe
        // the persisted entry. multi() is called at least twice: once for
        // the initial persist attempt, once for the cleanup in the catch.
        expect(multiSpy).toHaveBeenCalled();
        // No error is logged by the service itself — the catch only
        // re-throws; the caller is expected to surface/log the failure.
        expect(errorSpy).not.toHaveBeenCalled();
        vi.useRealTimers();
      });

      it("armLobbyCountdownTimer's setTimeout callback logs and swallows launchRoomMatch failures", async () => {
        vi.useFakeTimers();
        const { svc } = buildService();
        const launchError = new Error("launch boom");
        vi.spyOn(svc as any, "launchRoomMatch").mockRejectedValue(launchError);
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        (svc as any).armLobbyCountdownTimer(
          "r1",
          Date.now() + 5000,
          mockServer as unknown as Server,
        );

        // Advance past the countdown; the timer callback's .catch() runs
        await vi.advanceTimersByTimeAsync(5000);
        // Flush the void promise chain
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
          "Failed to auto-start lobby countdown for room r1",
          launchError,
        );
        vi.useRealTimers();
      });

      it("onModuleInit logs and swallows errors from the recovery launchRoomMatch (server wired up)", async () => {
        // The countdown is already past expiry, a server IS wired up, and
        // launchRoomMatch rejects — the .catch() on the fire-and-forget
        // promise must log the failure instead of crashing the process.
        const pastEnd = Date.now() - 1000;
        const { svc } = buildService({
          smembers: ["rExpired"],
          get: String(pastEnd),
        });
        const launchError = new Error("recovery launch boom");
        vi.spyOn(svc as any, "launchRoomMatch").mockRejectedValue(launchError);
        (svc as any).setServer(mockServer as unknown as Server);
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await svc.onModuleInit();
        // Flush the void promise chain
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
          "Recovery launch failed for room rExpired:",
          launchError,
        );
      });

      it("onModuleInit logs when clearPersistedCountdown itself fails during the no-server recovery path", async () => {
        // The countdown is past expiry AND no server is wired up, so the
        // service falls into the `else` branch and tries to clear the
        // persisted entry. If that clear call also rejects, the
        // .catch() on the fire-and-forget promise must log the failure
        // — otherwise an unhandled rejection would crash the process.
        const pastEnd = Date.now() - 1000;
        const { svc } = buildService({
          smembers: ["rExpiredNoServer"],
          get: String(pastEnd),
        });
        // No setServer() call → server is undefined → else branch
        vi.spyOn(svc as any, "clearPersistedCountdown").mockRejectedValue(
          new Error("clear boom"),
        );
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await svc.onModuleInit();
        // Flush the void promise chain
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
          "Failed to clear persisted countdown for room rExpiredNoServer:",
          expect.any(Error),
        );
      });

      it("launchRoomMatch throws ROOM_ALREADY_STARTED when the re-fetched room is no longer launchable (race)", async () => {
        // First getRoom returns a launchable state (COUNTDOWN). Between
        // that call and the inner re-fetch, the room's status changes
        // (e.g. another caller launched it). The second getRoom now
        // returns IN_GAME, and the service must throw ROOM_ALREADY_STARTED
        // instead of double-starting the match.
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.COUNTDOWN,
            currentMatchId: null,
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any)
          .mockResolvedValueOnce({
            id: "r1",
            status: RoomStatus.IN_GAME, // race: someone else already started it
            currentMatchId: "m-existing",
            players: [{ userId: "p1" }, { userId: "p2" }],
          } as any);
        // Make sure no stale countdown is in the in-memory map so we hit
        // the post-re-fetch race branch (otherwise the test would short-
        // circuit before the re-fetch).
        (service as any).lobbyCountdowns.delete("r1");
        (matchService.createMatch as any) = vi.fn();

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

        // createMatch must NOT be called — the re-fetch guard prevents a
        // double-start.
        expect(matchService.createMatch).not.toHaveBeenCalled();
        // Room must be rolled back to WAITING and a status event emitted
        expect(roomService.updateRoomStatus).toHaveBeenLastCalledWith(
          "r1",
          RoomStatus.WAITING,
        );
      });
    });
  });
});
