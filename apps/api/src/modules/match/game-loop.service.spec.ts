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
      .mockResolvedValue(undefined);

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

    // Call executeCountdown directly
    const promise = (service as any).executeCountdown(
      "match-1",
      "room-1",
      mockServer,
    );

    // Fast-forward timers
    vi.advanceTimersByTime(GAME_CONFIG.COUNTDOWN_DURATION_MS);

    await promise;

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
    expect(matchService.saveAnswer).toHaveBeenCalledTimes(2);

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

    // Start the match loop which should trigger the error
    const promise = service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    // Advance timers to trigger the error handling
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS + 100);

    await promise;

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
  it("should handle player disconnect and broadcast PLAYER_LEFT", async () => {
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

    // Call handlePlayerDisconnect
    await service.handlePlayerDisconnect(
      "match-1",
      "p1",
      mockServer as unknown as Server,
    );

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
});
