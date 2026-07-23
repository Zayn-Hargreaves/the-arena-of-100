import { MatchRoundRunner } from "./match-round-runner";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";
import { MatchStateMachine, UNAVAILABLE } from "@arena/game-core";
import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  ServerEvent,
  GAME_CONFIG,
  RoomError,
} from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, afterEach, it, expect, describe } from "vitest";

describe("MatchRoundRunner", () => {
  let runner: MatchRoundRunner;
  let matchService: MatchService;
  let questionService: QuestionService;
  let roomService: RoomService;
  let mockServer: Server;
  let stateMachine: MatchStateMachine;

  afterEach(() => {
    // Guard against tests that call vi.useFakeTimers() but bail out
    // via an assertion throw or a rejected promise before the inline
    // vi.useRealTimers() at the bottom of the test runs. Without this
    // hook, every later suite in the file would inherit a fake
    // Date/setTimeout and either hang on flush or skew ordering.
    vi.useRealTimers();
  });

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
      // H2-style endRound fix: round + answers are persisted
      // atomically in a single $transaction call.
      saveRoundAndAnswers: vi.fn().mockResolvedValue({ id: "round-1" }),
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

    // MatchRoundRunner is constructed directly with its three
    // collaborators — no GameLoopService, PrismaService, or
    // LobbyCountdownService involved. Those only existed in this
    // harness historically because these tests reached the runner
    // through `(gameLoopService as any).roundRunner`.
    runner = new MatchRoundRunner(
      matchService,
      questionService,
      roomService,
      // B2c: owner by default so the three fenced boundaries proceed.
      {
        assertOwnership: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("./match-ownership.service").MatchOwnershipService,
    );
  });

  it("should transition to COUNTDOWN and broadcast MATCH_STARTED", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Mock executeCountdown to avoid timeout issues
    const executeCountdownSpy = vi
      .spyOn(runner as any, "executeCountdown")
      .mockImplementation(() => {});

    await (runner as any).startMatchLoop(
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

  it("should execute countdown and call executeRound after 5 seconds", async () => {
    vi.useFakeTimers();

    // Mock executeRound to avoid side effects
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
      .mockResolvedValue(undefined);

    // Call executeCountdown directly (now synchronous void)
    (runner as any).executeCountdown("match-1", "room-1", mockServer);

    // Fast-forward timers
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  it("should fetch question, start round, and broadcast ROUND_STARTED", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    // Set state machine to COUNTDOWN state first
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // Initialize usedQuestionIds for this match
    (runner as any).timers.initUsedQuestions("match-1");

    // Call executeRound directly
    await (runner as any).executeRound("match-1", "room-1", mockServer);

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
    const usedQuestions = (runner as any).timers.getUsedQuestions("match-1");
    expect(usedQuestions).toContain("q1");

    vi.useRealTimers();
  });

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
    await (runner as any).endRound("match-1", "room-1", mockServer);

    // Check state transitions
    expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);

    // Check that round was evaluated. The round row + answer batch
    // are now committed via a single $transaction-backed call;
    // the answer map at the call site no longer carries roundId
    // (it's stamped inside the transaction).
    expect(matchService.saveRoundAndAnswers).toHaveBeenCalledWith(
      "match-1",
      1,
      "q1",
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

  it("emits AFK when eliminated player had no answer but was still online", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });

    // Only p1 answers correctly; p2 stays online with no answer (AFK).
    stateMachine.submitAnswer("p1", "A", Date.now());

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({
        matchId: "match-1",
        playerId: "p2",
        reason: "AFK",
      }),
    );

    vi.useRealTimers();
  });

  it("emits TIMEOUT when eliminated player had no answer and was offline", async () => {
    vi.useFakeTimers();

    const emitSpy = vi.fn();
    (mockServer.to as any).mockReturnValue({ emit: emitSpy });

    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });

    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.disconnectPlayer("p2");

    await (runner as any).endRound("match-1", "room-1", mockServer);

    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.PLAYER_ELIMINATED,
      expect.objectContaining({
        matchId: "match-1",
        playerId: "p2",
        reason: "TIMEOUT",
      }),
    );

    vi.useRealTimers();
  });

  it("should continue to next round when match should not end", async () => {
    vi.useFakeTimers();

    // Mock executeRound to avoid side effects
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
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
    await (runner as any).checkMatchEnd("match-1", "room-1", mockServer);

    // Should call executeRound for next round
    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

  it("should finish match when only one player remains", async () => {
    vi.useFakeTimers();

    // Mock finishMatchLoop to avoid side effects
    const finishMatchLoopSpy = vi
      .spyOn(runner as any, "finishMatchLoop")
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
    await (runner as any).checkMatchEnd("match-1", "room-1", mockServer);

    // Should call finishMatchLoop
    expect(finishMatchLoopSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );

    vi.useRealTimers();
  });

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
    await (runner as any).finishMatchLoop("match-1", "room-1", mockServer);

    // Check final state
    expect(stateMachine.getState().status).toBe(MatchStatus.FINISHED);

    // F1: finishMatch() returns void, winnerId read from state
    const winnerId = stateMachine.getState().winnerId;
    expect(winnerId).toBe("p1"); // p1 answered correctly

    // Check that match was finished in service (H2 + M4: the
    // roomId is now passed explicitly so the transaction can
    // update the Room row atomically with the Match row).
    expect(matchService.finishMatch).toHaveBeenCalledWith(
      "match-1",
      winnerId,
      "room-1",
      false,
    );

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
    expect((runner as any).timers.hasTimers("match-1")).toBeFalsy();
    expect((runner as any).timers.hasUsedQuestions("match-1")).toBeFalsy();

    vi.useRealTimers();
  });

  it("should clear timers and remove tracking maps", () => {
    // Initialize tracking for match
    (runner as any).timers.initUsedQuestions("match-1");
    (runner as any).timers.markQuestionUsed("match-1", "q1");
    (runner as any).timers.addTimer(
      "match-1",
      setTimeout(() => {}, 1000),
    );

    // Call cancelMatchLoop
    runner.cancelMatchLoop("match-1");

    // Check cleanup
    expect((runner as any).timers.hasUsedQuestions("match-1")).toBeFalsy();
    expect((runner as any).timers.hasTimers("match-1")).toBeFalsy();
  });

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
    (runner as any).timers.initUsedQuestions("match-1");

    // Start the match loop which triggers countdown and resolves immediately
    await (runner as any).startMatchLoop(
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
    (runner as any).timers.initUsedQuestions("match-1");

    // First round - start from COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);
    await (runner as any).executeRound("match-1", "room-1", mockServer);

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
    (runner as any).timers.initUsedQuestions("match-2");
    (runner as any).timers.markQuestionUsed("match-2", "q1");

    // Call executeRound for the second match
    await (runner as any).executeRound("match-2", "room-1", mockServer);

    // Check that the second call to getRandom was called with excludeIds
    expect(getRandomMock).toHaveBeenCalledTimes(2);
    expect(getRandomMock).toHaveBeenNthCalledWith(2, undefined, ["q1"]);

    vi.useRealTimers();
  });

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
      .spyOn(runner as any, "endRound")
      .mockResolvedValue(undefined);

    // Call checkEarlyTermination with all players having answered
    (runner as any).timers.setExpectedAnswers("match-1", 2); // Expect 2 answers
    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.submitAnswer("p2", "B", Date.now());

    await runner.checkEarlyTermination(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    // Should call endRound immediately
    expect(endRoundSpy).toHaveBeenCalledWith("match-1", "room-1", mockServer);

    // Should have cleared timers
    expect((runner as any).timers.hasTimers("match-1")).toBeFalsy();

    vi.useRealTimers();
  });

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
    await runner.handlePlayerDisconnect(
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
        roomId: "room-1",
        playerId: "p1",
        reason: "DISCONNECTED",
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
    await runner.handlePlayerDisconnect(
      "match-1",
      "non-existent-player",
      mockServer as unknown as Server,
    );

    // Verify persistStateMachine was NOT called
    expect(matchService.persistStateMachine).not.toHaveBeenCalled();

    // Verify PLAYER_LEFT was NOT emitted
    expect(emitSpy).not.toHaveBeenCalled();
  });

  describe("handleMatchPlayerLeft (C1)", () => {
    it("marks the player DISCONNECTED, persists, and broadcasts PLAYER_LEFT with reason=LEFT", async () => {
      // C1 fix: a voluntary LEAVE_ROOM while IN_GAME must update the
      // match state machine so the player can no longer submit
      // answers. The previous behaviour (state machine still ACTIVE
      // after RoomPlayer row was deleted) was a cheating vector.
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      const emitSpy = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
      (mockServer.to as any).mockImplementation(toMock);

      await runner.handleMatchPlayerLeft(
        "match-1",
        "room-1",
        "p1",
        mockServer as unknown as Server,
      );

      // The state machine now has p1 as DISCONNECTED.
      const updated = stateMachine.getState();
      expect(updated.players.get("p1")?.status).toBe(PlayerStatus.DISCONNECTED);
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");

      // The broadcast uses reason "LEFT" (not "DISCONNECTED") so the
      // UI can distinguish a voluntary leave from a socket drop.
      // Payload now matches RoomPlayerLeftPayload exactly — the
      // previous extra `matchId` field was dropped to keep the
      // room-channel broadcast shape consistent with the lobby
      // leave path in RoomHandler.handleLeaveRoom.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.PLAYER_LEFT,
        expect.objectContaining({
          roomId: "room-1",
          playerId: "p1",
          reason: "LEFT",
        }),
      );
    });

    it("still broadcasts PLAYER_LEFT when the state machine is gone (FINISHED case)", async () => {
      // The C1 path can run while the room is FINISHED — the match
      // state machine may already have been torn down. We must not
      // throw; we should still broadcast so spectator UIs update.
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        undefined as any,
      );
      const emitSpy = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
      (mockServer.to as any).mockImplementation(toMock);

      await runner.handleMatchPlayerLeft(
        "match-gone",
        "room-1",
        "p1",
        mockServer as unknown as Server,
      );

      // No persist call when there's no state machine.
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      // Broadcast still happens with the same payload shape.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.PLAYER_LEFT,
        expect.objectContaining({
          roomId: "room-1",
          playerId: "p1",
          reason: "LEFT",
        }),
      );
    });
  });

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
      const firstCall = (runner as any).endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      // 2. Call endRound immediately a second time while first is running
      // Since JavaScript is single-threaded, if we call endRound again concurrently,
      // it should hit the `endingRounds` lock check and return early.
      const secondCall = (runner as any).endRound(
        "match-1",
        "room-1",
        mockServer,
      );

      await Promise.all([firstCall, secondCall]);

      // State machine should only have evaluated and saved once
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
    });

    it("should bypass endRound if match status is not ROUND_ACTIVE or round is not ACTIVE", async () => {
      // Set up a state other than ROUND_ACTIVE (e.g. finished)
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.FINISHED);

      // Spy on transition and evaluateRound
      const transitionSpy = vi.spyOn(stateMachine, "transition");
      const evaluateSpy = vi.spyOn(stateMachine, "evaluateRound");

      // Call endRound directly
      await (runner as any).endRound("match-1", "room-1", mockServer);

      // Since the match status is FINISHED, it should bypass transition and evaluation
      expect(transitionSpy).not.toHaveBeenCalled();
      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("should catch and log errors in timeout callbacks", async () => {
      vi.useFakeTimers();

      const loggerErrorSpy = vi.spyOn((runner as any).logger, "error");

      // Mock endRound and checkMatchEnd to throw errors
      const endRoundSpy = vi
        .spyOn(runner as any, "endRound")
        .mockRejectedValue(new Error("endRound failure"));
      const checkMatchEndSpy = vi
        .spyOn(runner as any, "checkMatchEnd")
        .mockRejectedValue(new Error("checkMatchEnd failure"));

      // 1. Trigger the executeRound timeout
      stateMachine.transition(MatchStatus.COUNTDOWN);
      (runner as any).timers.initUsedQuestions("match-1");
      await (runner as any).executeRound("match-1", "room-1", mockServer);

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
      const loggerErrorSpy2 = vi.spyOn((runner as any).logger, "error");

      // Re-mock saveRoundAndAnswers for endRound
      (matchService.saveRoundAndAnswers as any).mockResolvedValue({
        id: "round-1",
      });

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
      await (runner as any).endRound("match-2", "room-1", mockServer);

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

      const loggerErrorSpy = vi.spyOn((runner as any).logger, "error");

      // Mock executeRound to throw/reject
      vi.spyOn(runner as any, "executeRound").mockRejectedValue(
        new Error("countdown round failure"),
      );

      // Call executeCountdown directly
      (runner as any).executeCountdown("match-1", "room-1", mockServer);

      // Fast-forward timers
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Failed to execute round for match match-1:",
        expect.any(Error),
      );

      vi.useRealTimers();
    });

    it("should log string rejections in the endRound timeout callback", async () => {
      const loggerErrorSpy = vi.spyOn((runner as any).logger, "error");
      (runner as any).timers.initUsedQuestions("match-endround-string");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      let capturedTimeout: (() => Promise<void>) | undefined;
      setTimeoutSpy.mockImplementation(((handler: () => Promise<void>) => {
        capturedTimeout = handler;
        return 1 as any;
      }) as any);

      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1", "p2"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => ({
          status: "ACTIVE",
          question: { id: "q1" },
          answers: new Map([
            ["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }],
            ["p2", { answer: "A", isCorrect: true, responseTimeMs: 120 }],
          ]),
          endsAt: Date.now() + 1000,
        }),
        transition: vi.fn(),
        startRound: vi.fn().mockReturnValue({
          status: "ACTIVE",
          question: { id: "q1" },
          answers: new Map([
            ["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }],
            ["p2", { answer: "A", isCorrect: true, responseTimeMs: 120 }],
          ]),
          endsAt: Date.now() + 1000,
        }),
        evaluateRound: vi.fn().mockReturnValue({
          survivingIds: ["p1", "p2"],
          eliminatedIds: [],
          correctAnswer: "A",
        }),
      } as any;

      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      // Throw a string so the timer catch logs via String(error).
      vi.spyOn(runner as any, "endRound").mockImplementationOnce(() => {
        throw "endRound failure (string)";
      });

      await (runner as any).executeRound(
        "match-endround-string",
        "room-1",
        mockServer,
      );
      await capturedTimeout?.();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error in endRound timeout callback for match match-endround-string:",
        ),
        expect.any(String),
      );

      setTimeoutSpy.mockRestore();
    });
  });

  describe("Branch coverage follow-ups", () => {
    it("bypasses endRound when the round exists but is not ACTIVE", async () => {
      const inactiveRound = {
        status: "WAITING",
        question: { id: "q1" },
        answers: new Map(),
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 2,
          players: new Map(),
        }),
        getCurrentRound: () => inactiveRound,
        transition: vi.fn(),
        evaluateRound: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );

      await (runner as any).endRound("match-bypass", "room-1", mockServer);

      expect(fakeStateMachine.transition).not.toHaveBeenCalled();
      expect(fakeStateMachine.evaluateRound).not.toHaveBeenCalled();
    });

    it("bypasses endRound when the match is not ROUND_ACTIVE even if the current round is ACTIVE", async () => {
      const activeRound = {
        status: "ACTIVE",
        question: { id: "q1" },
        answers: new Map(),
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.FINISHED,
          currentRoundNo: 2,
          players: new Map(),
        }),
        getCurrentRound: () => activeRound,
        transition: vi.fn(),
        evaluateRound: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );

      await (runner as any).endRound("match-bypass-2", "room-1", mockServer);

      expect(fakeStateMachine.transition).not.toHaveBeenCalled();
      expect(fakeStateMachine.evaluateRound).not.toHaveBeenCalled();
    });

    it("passes an empty exclude list when no used questions are tracked yet", async () => {
      const getRandomSpy = vi
        .spyOn(questionService, "getRandom")
        .mockResolvedValueOnce({
          id: "q-unused",
          content: "Question",
          options: ["A", "B"],
          correctAnswer: "A",
          difficulty: "MEDIUM",
        } as any);

      const getSpy = vi.spyOn((runner as any).timers, "getUsedQuestions");
      getSpy.mockImplementationOnce(() => undefined);
      getSpy.mockImplementationOnce(() => new Set());

      stateMachine.transition(MatchStatus.COUNTDOWN);
      await (runner as any).executeRound("match-unique", "room-1", mockServer);

      expect(getRandomSpy).toHaveBeenCalledWith(undefined, []);
    });

    it("skips eliminated players missing from state when broadcasting PLAYER_ELIMINATED", async () => {
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
      ];
      const testStateMachine = new MatchStateMachine(
        "match-missing-player",
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
      testStateMachine.submitAnswer("p1", "B", Date.now());

      vi.spyOn(testStateMachine, "evaluateRound").mockReturnValue({
        survivingIds: [],
        eliminatedIds: ["ghost-player"],
        correctAnswer: "A",
      } as any);

      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        testStateMachine,
      );
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound(
        "match-missing-player",
        "room-1",
        mockServer,
      );

      // No PLAYER_ELIMINATED event for a missing player; the branch is
      // the `continue` path in the loop.
      expect(
        emitSpy.mock.calls.some(
          (call) => call[0] === ServerEvent.PLAYER_ELIMINATED,
        ),
      ).toBe(false);
    });

    it("logs timeout callback failures when checkMatchEnd rejects with a non-Error", async () => {
      const loggerErrorSpy = vi.spyOn((runner as any).logger, "error");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      let capturedTimeout: (() => Promise<void>) | undefined;
      setTimeoutSpy.mockImplementation(((handler: () => Promise<void>) => {
        capturedTimeout = handler;
        return 1 as any;
      }) as any);

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
      ];
      const testStateMachine = new MatchStateMachine(
        "match-string-error",
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
      testStateMachine.submitAnswer("p1", "A", Date.now());

      vi.spyOn(testStateMachine, "evaluateRound").mockReturnValue({
        survivingIds: ["p1"],
        eliminatedIds: [],
        correctAnswer: "A",
      } as any);

      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        testStateMachine,
      );
      vi.spyOn(runner as any, "checkMatchEnd").mockImplementationOnce(() => {
        throw "boom-string";
      });

      await (runner as any).endRound(
        "match-string-error",
        "room-1",
        mockServer,
      );
      await capturedTimeout?.();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error in checkMatchEnd timeout callback for match match-string-error:",
        ),
        expect.any(String),
      );

      setTimeoutSpy.mockRestore();
    });

    it("reads the expectedAnswers fallback of 0 when none exists", async () => {
      const testStateMachine = {
        getState: () => ({ status: MatchStatus.ROUND_ACTIVE }),
        getCurrentRound: () => null,
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        testStateMachine,
      );
      const endRoundSpy = vi
        .spyOn(runner as any, "endRound")
        .mockResolvedValue(undefined);

      await runner.checkEarlyTermination(
        "match-expected-0",
        "room-1",
        mockServer,
      );

      expect(endRoundSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("Missing Coverage (Null Guards & Optional Params)", () => {
    it("should throw RoomError in startMatchLoop if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const loggerErrorSpy = vi.spyOn((runner as any).logger, "error");

      await expect(
        (runner as any).startMatchLoop(
          "match-nonexistent",
          "room-1",
          mockServer,
        ),
      ).rejects.toThrow(RoomError);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "State machine not found for match match-nonexistent",
      );
    });

    it("should return early in executeRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const startRoundSpy = vi.spyOn(stateMachine, "startRound");

      await (runner as any).executeRound(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(startRoundSpy).not.toHaveBeenCalled();
    });

    it("should return early in endRound if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const evaluateSpy = vi.spyOn(stateMachine, "evaluateRound");

      await (runner as any).endRound("match-nonexistent", "room-1", mockServer);

      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("should return early in checkMatchEnd if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const shouldEndSpy = vi.spyOn(stateMachine, "shouldEndMatch");

      await (runner as any).checkMatchEnd(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(shouldEndSpy).not.toHaveBeenCalled();
    });

    it("should return early in finishMatchLoop if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const transitionSpy = vi.spyOn(stateMachine, "transition");

      await (runner as any).finishMatchLoop(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(transitionSpy).not.toHaveBeenCalled();
    });

    it("should return early in handlePlayerDisconnect if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const loggerWarnSpy = vi.spyOn((runner as any).logger, "warn");

      const outcome = await runner.handlePlayerDisconnect(
        "match-nonexistent",
        "p1",
        mockServer,
      );

      expect(loggerWarnSpy).not.toHaveBeenCalled();
      // B5 hardening: return "NOOP" so the command-stream wrapper acks.
      expect(outcome).toBe("NOOP");
    });

    it("should return early in checkEarlyTermination if stateMachine is not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);
      const getRoundSpy = vi.spyOn(stateMachine, "getCurrentRound");

      await runner.checkEarlyTermination(
        "match-nonexistent",
        "room-1",
        mockServer,
      );

      expect(getRoundSpy).not.toHaveBeenCalled();
    });

    // L6 fix: the dead `serverOrContext` parameter was removed in
    // the same change that eliminated its debug log. There is no
    // longer an optional fourth argument to test; the L6 contract
    // is "finishMatchLoop(matchId, roomId, server) with exactly
    // three required parameters", pinned by the existing
    // "should finish match and read winnerId from state" test
    // above and the caller-side types in
    // `game-loop.service.ts:990`.
    it("L6 fix: finishMatchLoop no longer accepts a fourth context argument", () => {
      // Compile-time check: the function's parameter count is 3
      // (matchId, roomId, server). We read .length off the
      // function reference to make any future re-introduction of
      // the dead parameter fail this test.
      expect(
        (
          runner as any as unknown as {
            finishMatchLoop: (...args: unknown[]) => unknown;
          }
        ).finishMatchLoop.length,
      ).toBe(3);
    });

    // B1 fix: idempotency guard for finishMatchLoop. Two callers
    // (checkMatchEnd timer + admin kill-switch) must not both
    // write the Match row for the same matchId. We verify the
    // Set-based guard returns early without calling
    // `matchService.finishMatch` twice.
    it("B1: finishMatchLoop is a no-op on the second concurrent call for the same matchId", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      // Pre-mark this matchId as "already finishing" to simulate
      // an in-flight first call. The guard should detect the Set
      // membership and bail out.
      (runner as any).timers.beginFinish("match-1");
      try {
        await (runner as any).finishMatchLoop("match-1", "room-1", mockServer);

        // No DB write, no broadcast, no state transition.
        expect(matchService.finishMatch).not.toHaveBeenCalled();
        expect(matchService.persistStateMachine).not.toHaveBeenCalled();
        expect(emitSpy).not.toHaveBeenCalledWith(
          ServerEvent.MATCH_FINISHED,
          expect.anything(),
        );
      } finally {
        (runner as any).timers.endFinish("match-1");
      }

      vi.useRealTimers();
    });

    it("B1: isMatchFinishing returns true while finishMatchLoop is in-flight", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      // Drive the service into a state where finishMatchLoop
      // has work to do. The first call would normally grab the
      // matchId into the Set and then clear it in `finally`.
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
      stateMachine.evaluateRound();

      // Sanity: outside of an in-flight call, the guard returns false.
      expect(runner.isMatchFinishing("match-1")).toBe(false);

      // Manually mark the Set (simulating "currently in flight")
      // and assert isMatchFinishing flips.
      (runner as any).timers.beginFinish("match-1");
      expect(runner.isMatchFinishing("match-1")).toBe(true);
      (runner as any).timers.endFinish("match-1");
      expect(runner.isMatchFinishing("match-1")).toBe(false);

      vi.useRealTimers();
    });

    it("B1: finishMatchLoop releases the finishingMatches guard in finally", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

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
      stateMachine.evaluateRound();

      await (runner as any).finishMatchLoop("match-1", "room-1", mockServer);

      // After the call returns, the Set should no longer contain
      // the matchId. This is critical: a thrown DB error inside
      // finishMatchLoop must not lock the match out of future
      // finish attempts.
      expect((runner as any).timers.isFinishing("match-1")).toBe(false);
      expect(runner.isMatchFinishing("match-1")).toBe(false);

      vi.useRealTimers();
    });

    it("B1: finishMatchLoop still releases the guard even if finishMatch throws", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

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
      stateMachine.evaluateRound();

      // Force finishMatch to throw, then verify the guard is
      // still released so a follow-up call (e.g. from the admin
      // path) can succeed.
      vi.mocked(matchService.finishMatch).mockRejectedValueOnce(
        new Error("DB down"),
      );

      await expect(
        (runner as any).finishMatchLoop("match-1", "room-1", mockServer),
      ).rejects.toThrow("DB down");

      expect((runner as any).timers.isFinishing("match-1")).toBe(false);
      expect(runner.isMatchFinishing("match-1")).toBe(false);

      vi.useRealTimers();
    });

    // B2 fix: when determineWinner returns null (empty roster or
    // unresolvable tie-break), finishMatchLoop must not crash on
    // the non-null assertion and must persist an explicit null
    // winnerId. The previous code wrote `undefined` to Prisma,
    // which silently dropped the field — the DB would keep the
    // stale winnerId instead of marking the match finished with
    // no winner.
    it("B2: finishMatchLoop persists null winnerId and emits MATCH_FINISHED.winnerId: null", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      // Force the state machine into the empty-roster path. We
      // can either drive a real empty-roster setup (annoying with
      // shared `stateMachine`) or stub `determineWinner` directly
      // for this test. Stubbing keeps the test focused on the
      // finishMatchLoop handling rather than the state machine.
      const determineWinnerSpy = vi
        .spyOn(stateMachine, "determineWinner")
        .mockReturnValue(null as unknown as string);

      // Set up a minimal ROUND_RESULT transition (the state
      // machine that finishMatchLoopInner will then transition to
      // FINISHED). We do NOT pre-transition to FINISHED because
      // finishMatchLoop owns that transition.
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      await (runner as any).finishMatchLoop("match-1", "room-1", mockServer);

      // finishMatch on the service must receive an explicit null,
      // not undefined (Prisma would drop the field for undefined).
      expect(matchService.finishMatch).toHaveBeenCalledWith(
        "match-1",
        null,
        "room-1",
        false,
      );

      // MATCH_FINISHED wire payload carries the explicit null
      // winnerId so clients can render the "no winner" state.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.MATCH_FINISHED,
        expect.objectContaining({
          matchId: "match-1",
          winnerId: null,
        }),
      );

      // The non-null assertion path is gone; if it were still
      // there, this test would have crashed with a TypeError.
      determineWinnerSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("executeCountdown M5 defence-in-depth", () => {
    it("logs and skips executeRound when the state machine is gone in the timer callback", async () => {
      // New branch: the `if (!sm) { this.logger.log(...); return; }`
      // arm at game-loop.service.ts:768-774. The M5 fix is
      // defence-in-depth against a race where `stopRoomRuntime`
      // tears down the match between setTimeout firing and the
      // callback body reaching the state-machine lookup.
      vi.useFakeTimers();
      const executeRoundSpy = vi
        .spyOn(runner as any, "executeRound")
        .mockResolvedValue(undefined);
      const logSpy = vi.spyOn((runner as any).logger, "log");

      // Force the in-callback `getStateMachine` to return
      // undefined (simulating a torn-down match).
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        undefined as any,
      );

      (runner as any).executeCountdown("match-1", "room-1", mockServer);
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

      expect(executeRoundSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "executeCountdown callback: state machine gone for match match-1",
        ),
      );

      vi.useRealTimers();
    });
  });

  describe("endRound H3 DB failure rethrows", () => {
    it("logs at error level and re-throws when saveRoundAndAnswers throws (state stays in ROUND_EVALUATING)", async () => {
      // New branch: the `catch (dbError)` block at
      // game-loop.service.ts:1035-1047. The persistence
      // spec covers that the call rejects, but the
      // `logger.error` call inside the catch is only
      // exercised here. We assert both the log and the
      // state-machine invariant (it must NOT have advanced
      // to ROUND_RESULT).
      vi.useFakeTimers();
      const errorSpy = vi
        .spyOn((runner as any).logger, "error")
        .mockImplementation(() => {});
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

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

      vi.mocked(matchService.saveRoundAndAnswers).mockRejectedValueOnce(
        new Error("db connection reset"),
      );

      await expect(
        (runner as any).endRound("match-1", "room-1", mockServer),
      ).rejects.toThrow("db connection reset");

      // The H3 fix guarantees the state machine is NOT
      // advanced to ROUND_RESULT — the next round timer
      // (or admin) can retry from ROUND_EVALUATING.
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_EVALUATING);
      expect(matchService.persistStateMachine).toHaveBeenCalledTimes(1);
      // No ROUND_ENDED / MATCH_FINISHED broadcast — the
      // round did not complete.
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.anything(),
      );
      // The H3 log line fired at error level (operators
      // must see this).
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "H3: endRound DB persistence failed for match match-1 round 1",
        ),
        expect.any(Error),
      );

      vi.useRealTimers();
    });
  });

  describe("B2c fail-closed fencing branches", () => {
    const makeRunner = (
      ownershipOverrides: Record<string, unknown> = {},
      disposeCommandStream?: (matchId: string) => Promise<void>,
    ): MatchRoundRunner =>
      new MatchRoundRunner(
        matchService,
        questionService,
        roomService,
        {
          assertOwnership: vi.fn().mockResolvedValue(true),
          release: vi.fn().mockResolvedValue(undefined),
          ...ownershipOverrides,
        } as unknown as import("./match-ownership.service").MatchOwnershipService,
        disposeCommandStream,
      );

    const armActiveRound = () => {
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q1",
        content: "Q",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });
    };

    it("startMatchLoop: a non-APPLIED persist skips MATCH_STARTED and the countdown", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("RETRY");

      const runner2 = makeRunner();
      await runner2.startMatchLoop(
        "match-1",
        "room-1",
        mockServer as unknown as Server,
      );

      const emittedEvents = emitSpy.mock.calls.map((c) => c[0]);
      expect(emittedEvents).not.toContain(ServerEvent.MATCH_STARTED);
      // No countdown was armed → advancing past it drives no round.
      await vi.advanceTimersByTimeAsync(
        GAME_CONFIG.COUNTDOWN_DURATION_MS + 100,
      );
      expect(questionService.getRandom).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("endRound: assertOwnership=false aborts before any persist, DB write, transition, or broadcast", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      armActiveRound();

      const runner2 = makeRunner({
        assertOwnership: vi.fn().mockResolvedValue(false),
      });
      await (runner2 as any).endRound("match-1", "room-1", mockServer);

      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(matchService.saveRoundAndAnswers).not.toHaveBeenCalled();
      // No transition off ROUND_ACTIVE, no broadcast.
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_ACTIVE);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("endRound: an eval-snapshot persist RETRY aborts before saveRoundAndAnswers / ROUND_RESULT / broadcast", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      armActiveRound();

      // The ROUND_EVALUATING snapshot persist reports a lost lease (RETRY). The
      // round must not write the DB, advance to ROUND_RESULT, or broadcast.
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("RETRY");

      await (runner as any).endRound("match-1", "room-1", mockServer);

      expect(matchService.saveRoundAndAnswers).not.toHaveBeenCalled();
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_EVALUATING);
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.anything(),
      );
    });

    it("executeRound: assertOwnership=false aborts before transition / ROUND_STARTED", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      stateMachine.transition(MatchStatus.COUNTDOWN);

      const runner2 = makeRunner({
        assertOwnership: vi.fn().mockResolvedValue(false),
      });
      await (runner2 as any).executeRound("match-1", "room-1", mockServer);

      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(questionService.getRandom).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_STARTED,
        expect.anything(),
      );
      expect(stateMachine.getState().status).toBe(MatchStatus.COUNTDOWN);
    });

    it("executeRound: a non-APPLIED persist skips ROUND_STARTED and the round timer", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      stateMachine.transition(MatchStatus.COUNTDOWN);
      (runner as any).timers.initUsedQuestions("match-1");
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("RETRY");

      const endRoundSpy = vi
        .spyOn(runner as any, "endRound")
        .mockResolvedValue(undefined);

      await (runner as any).executeRound("match-1", "room-1", mockServer);

      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_STARTED,
        expect.anything(),
      );
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS + 100);
      expect(endRoundSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("endRound: a result-phase persist RETRY skips ROUND_ENDED after ROUND_RESULT transition", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      armActiveRound();

      // handleActiveRoundEnd snapshot + eval-phase APPLIED; result-phase RETRY.
      vi.mocked(matchService.persistStateMachine)
        .mockResolvedValueOnce("APPLIED")
        .mockResolvedValueOnce("APPLIED")
        .mockResolvedValueOnce("RETRY");

      await (runner as any).endRound("match-1", "room-1", mockServer);

      expect(matchService.saveRoundAndAnswers).toHaveBeenCalled();
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_RESULT);
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.anything(),
      );
    });

    it("endRound: an eval-phase persist RETRY after saveRoundAndAnswers aborts before ROUND_RESULT", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      armActiveRound();

      // handleActiveRoundEnd snapshot APPLIED → DB save succeeds → eval-phase
      // persist RETRY → must not transition to ROUND_RESULT or broadcast.
      vi.mocked(matchService.persistStateMachine)
        .mockResolvedValueOnce("APPLIED")
        .mockResolvedValueOnce("RETRY");

      await (runner as any).endRound("match-1", "room-1", mockServer);

      expect(matchService.saveRoundAndAnswers).toHaveBeenCalled();
      expect(stateMachine.getState().status).toBe(MatchStatus.ROUND_EVALUATING);
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.anything(),
      );
    });

    it("checkMatchEnd: assertOwnership=false aborts before next-round or finish", async () => {
      const runner2 = makeRunner({
        assertOwnership: vi.fn().mockResolvedValue(false),
      });
      const executeRoundSpy = vi
        .spyOn(runner2 as any, "executeRound")
        .mockResolvedValue(undefined);
      const finishSpy = vi
        .spyOn(runner2 as any, "finishMatchLoop")
        .mockResolvedValue(undefined);

      await (runner2 as any).checkMatchEnd("match-1", "room-1", mockServer);

      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(executeRoundSpy).not.toHaveBeenCalled();
      expect(finishSpy).not.toHaveBeenCalled();
    });

    it("finishMatchLoopInner: assertOwnership=false aborts before DB finish / MATCH_FINISHED", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      const release = vi.fn().mockResolvedValue(undefined);
      const runner2 = makeRunner({
        assertOwnership: vi.fn().mockResolvedValue(false),
        release,
      });

      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      await (runner2 as any).finishMatchLoop("match-1", "room-1", mockServer);

      expect(matchService.finishMatch).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.MATCH_FINISHED,
        expect.anything(),
      );
      expect(release).not.toHaveBeenCalled();
    });

    it("finishMatchLoopInner: a non-APPLIED persist defers finish/broadcast to the owner", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      const release = vi.fn().mockResolvedValue(undefined);
      const runner2 = makeRunner({ release });
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("RETRY");

      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      await (runner2 as any).finishMatchLoop("match-1", "room-1", mockServer);

      expect(matchService.finishMatch).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalledWith(
        ServerEvent.MATCH_FINISHED,
        expect.anything(),
      );
      expect(release).not.toHaveBeenCalled();
    });

    it("finishMatchLoopInner: releases ownership after a confirmed finish", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      const release = vi.fn().mockResolvedValue(undefined);
      const disposeCommandStream = vi.fn().mockResolvedValue(undefined);
      const runner2 = makeRunner({ release }, disposeCommandStream);

      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      await (runner2 as any).finishMatchLoop("match-1", "room-1", mockServer);

      expect(matchService.finishMatch).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.MATCH_FINISHED,
        expect.objectContaining({ matchId: "match-1" }),
      );
      expect(release).toHaveBeenCalledWith("match-1");
      // B4b: natural finish drops match:cmd + match:applied.
      expect(disposeCommandStream).toHaveBeenCalledWith("match-1");
    });

    it("handlePlayerDisconnect: a non-APPLIED persist skips the disconnect broadcast and propagates the outcome", async () => {
      // B5 hardening: the runner now returns the underlying persist outcome so
      // the command-stream wrapper can decide XACK vs RETRY. A non-APPLIED
      // outcome here means the lease was lost mid-apply; the wrapper MUST map
      // this to "RETRY" so the entry stays pending for the new owner.
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("RETRY");

      const outcome = await runner.handlePlayerDisconnect(
        "match-1",
        "p1",
        mockServer as unknown as Server,
      );

      expect(matchService.persistStateMachine).toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
      expect(outcome).toBe("RETRY");
    });

    it("handlePlayerDisconnect: BLIND persist outcome is also propagated (no broadcast)", async () => {
      // Symmetric coverage for the BLIND branch — same XACK-vs-RETRY contract.
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("BLIND");

      const outcome = await runner.handlePlayerDisconnect(
        "match-1",
        "p1",
        mockServer as unknown as Server,
      );

      expect(emitSpy).not.toHaveBeenCalled();
      expect(outcome).toBe("BLIND");
    });

    it("handlePlayerDisconnect: APPLIED persist returns 'APPLIED' after the broadcast", async () => {
      // Symmetric coverage for the happy path.
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(matchService.persistStateMachine).mockResolvedValue("APPLIED");

      const outcome = await runner.handlePlayerDisconnect(
        "match-1",
        "p1",
        mockServer as unknown as Server,
      );

      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.PLAYER_LEFT,
        expect.objectContaining({
          roomId: "room-1",
          playerId: "p1",
          reason: "DISCONNECTED",
        }),
      );
      expect(outcome).toBe("APPLIED");
    });

    it("handlePlayerDisconnect: missing state machine returns 'NOOP' (ackable)", async () => {
      // Pre-conditions failed → no persist attempted → caller can XACK.
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);

      const outcome = await runner.handlePlayerDisconnect(
        "match-nonexistent",
        "p1",
        mockServer as unknown as Server,
      );

      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(outcome).toBe("NOOP");
    });

    it("handlePlayerDisconnect: unknown player returns 'NOOP' (ackable)", async () => {
      // Same as the missing-SM case: nothing to persist, ackable no-op.
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      const outcome = await runner.handlePlayerDisconnect(
        "match-1",
        "non-existent-player",
        mockServer as unknown as Server,
      );

      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
      expect(outcome).toBe("NOOP");
    });
  });

  describe("finishMatchLoopInner null-winner logging", () => {
    it("logs a warning when finishMatchLoopInner completes with winnerId: null (B2)", async () => {
      // New branch: the `if (winnerId === null) { logger.warn(...) }`
      // arm at game-loop.service.ts:1237-1240. The existing
      // B2 test asserts the wire payload and the DB call,
      // but does NOT assert the log line. Operators rely
      // on this log to detect matches that finished with
      // an empty roster or unresolvable tie-break.
      vi.useFakeTimers();
      const warnSpy = vi.spyOn((runner as any).logger, "warn");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      // Force winnerId: null via the state machine.
      vi.spyOn(stateMachine, "determineWinner").mockReturnValue(
        null as unknown as string,
      );

      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      await (runner as any).finishMatchLoop("match-1", "room-1", mockServer);

      // The wire payload carries winnerId: null (existing
      // B2 assertion, restated for clarity).
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.MATCH_FINISHED,
        expect.objectContaining({ winnerId: null }),
      );
      // The null-winner log line fires.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Match match-1 finished with no winner"),
      );

      vi.useRealTimers();
    });
  });

  describe("checkEarlyTermination H1 explicit guard", () => {
    it("returns early without calling endRound when endingRounds already contains the matchId", async () => {
      // New branch: the `if (this.endingRounds.has(matchId))
      // return;` arm at game-loop.service.ts:1400-1402. The
      // H1 fix pinned the guard at the entry of
      // checkEarlyTermination (it was previously only in
      // endRound, which is still a no-op when the second
      // caller reaches it). The guard must short-circuit
      // BEFORE we hit the state machine / executeRound.
      const endRoundSpy = vi
        .spyOn(runner as any, "endRound")
        .mockResolvedValue(undefined);

      // Pre-mark the matchId as already-ending.
      (runner as any).timers.beginEndRound("match-1");
      try {
        await runner.checkEarlyTermination(
          "match-1",
          "room-1",
          mockServer as unknown as Server,
        );
      } finally {
        (runner as any).timers.endEndRound("match-1");
      }

      expect(endRoundSpy).not.toHaveBeenCalled();
      // We never even reach the state-machine lookup.
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
    });
  });

  describe("timeout callbacks execution", () => {
    it("executes the actual endRound and checkMatchEnd timeout callbacks successfully without mocks", async () => {
      vi.useFakeTimers();

      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      // Set state machine to COUNTDOWN state first
      stateMachine.transition(MatchStatus.COUNTDOWN);

      // Initialize usedQuestionIds for this match
      (runner as any).timers.initUsedQuestions("match-1");

      const endRoundSpy = vi.spyOn(runner as any, "endRound");
      const checkMatchEndSpy = vi.spyOn(runner as any, "checkMatchEnd");

      // 1. Call executeRound directly to transition to ROUND_ACTIVE and set the 15s endRound timer
      await (runner as any).executeRound("match-1", "room-1", mockServer);

      // 2. Fast forward 15s to trigger the endRound timer callback
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);

      // Verify endRound was called through the timeout callback (line 957)
      expect(endRoundSpy).toHaveBeenCalledWith("match-1", "room-1", mockServer);

      // 3. Fast forward 3s to trigger the checkMatchEnd timer callback
      await vi.advanceTimersByTimeAsync(GAME_CONFIG.RESULT_DISPLAY_MS);

      // Verify checkMatchEnd was called through the timeout callback (line 1109)
      expect(checkMatchEndSpy).toHaveBeenCalledWith(
        "match-1",
        "room-1",
        mockServer,
      );

      vi.useRealTimers();
    });
  });

  // ============================================================
  // L3 recovery path: endRound with state.status = ROUND_EVALUATING
  // AND round.status = "COMPLETED". This is the path taken after a
  // process restart between evaluateRound() (which sets round.status
  // to COMPLETED and persists to Redis) and the DB write
  // (saveRoundAndAnswers). The runner must re-derive eliminatedIds
  // from the persisted snapshot rather than re-running the live
  // evaluation.
  // ============================================================
  describe("endRound recovery path (L3: ROUND_EVALUATING + COMPLETED)", () => {
    // We omit the getEventLog() entry so the runner falls through
    // to the `else` block that calls getRecoveryStartingPlayers.
    // Each test below inlines its own fake state machine because
    // the field set varies per branch (correctAnswer empty vs
    // present, startingPlayers UNAVAILABLE vs string[] vs missing).

    it("Test A: getRecoveryStartingPlayers UNAVAILABLE branch — log + eliminatedIds = []", async () => {
      // The L3 recovery path with `startingPlayers === UNAVAILABLE`
      // is the case the codec hits when a legacy / future
      // _stateVersion was loaded. The runner must not crash, must
      // not infer eliminations from cumulative state, and must log
      // both warnings (helper + skip-eliminations).
      const round = {
        matchId: "match-1",
        roundNo: 1,
        question: { id: "q1", content: "Q?", options: ["A", "B"] },
        startedAt: 100,
        endsAt: 1000,
        answers: new Map<
          string,
          { answer: string; isCorrect: boolean; responseTimeMs: number }
        >([["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }]]),
        status: "COMPLETED",
        correctAnswer: "A",
        startingPlayers: UNAVAILABLE,
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_EVALUATING,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => round,
        getEventLog: () => [],
        transition: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      const warnSpy = vi.spyOn((runner as any).logger, "warn");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound("match-1", "room-1", mockServer);

      // The helper warns (input branch) AND the recovery handler
      // warns (skip branch). The two messages are distinct so
      // operators can distinguish "missing snapshot" from "skipped
      // eliminatedIds".
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Recovery round snapshot unavailable for match match-1 round 1: startingPlayers is UNAVAILABLE",
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Recovery for match match-1 round 1 skipped eliminatedIds: startingPlayers is UNAVAILABLE",
        ),
      );

      // Despite no eliminatedIds, the round must still be persisted
      // (the round row exists from the original evaluateRound) and
      // the state machine advances to ROUND_RESULT.
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
      expect(fakeStateMachine.transition).toHaveBeenCalledWith(
        MatchStatus.ROUND_RESULT,
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.objectContaining({
          matchId: "match-1",
          roundNo: 1,
          correctAnswer: "A",
          eliminatedPlayerIds: [],
        }),
      );
      // No PLAYER_ELIMINATED was emitted because eliminatedIds is [].
      expect(
        emitSpy.mock.calls.some(
          (call) => call[0] === ServerEvent.PLAYER_ELIMINATED,
        ),
      ).toBe(false);
    });

    it("Test B: getRecoveryStartingPlayers fallback (missing) branch — log + eliminatedIds = []", async () => {
      // The `else` arm of the helper: startingPlayers is neither
      // UNAVAILABLE nor an array (e.g. undefined, or some unexpected
      // shape). The helper logs the "missing" warning and returns
      // UNAVAILABLE; the recovery handler then logs the "skipped"
      // warning and zeros out eliminatedIds.
      const round = {
        matchId: "match-1",
        roundNo: 1,
        question: { id: "q1", content: "Q?", options: ["A", "B"] },
        startedAt: 100,
        endsAt: 1000,
        answers: new Map<
          string,
          { answer: string; isCorrect: boolean; responseTimeMs: number }
        >([["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }]]),
        status: "COMPLETED",
        correctAnswer: "A",
        // Intentionally NOT setting startingPlayers — undefined hits
        // the fallback branch.
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_EVALUATING,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => round,
        getEventLog: () => [],
        transition: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      const warnSpy = vi.spyOn((runner as any).logger, "warn");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound("match-1", "room-1", mockServer);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Recovery round snapshot unavailable for match match-1 round 1: startingPlayers missing",
        ),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Recovery for match match-1 round 1 skipped eliminatedIds: startingPlayers is UNAVAILABLE",
        ),
      );
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.objectContaining({ eliminatedPlayerIds: [] }),
      );
    });

    it("Test C: Recovery rehydrates correctAnswer from questionService.findOne, then calls eliminationsForRound", async () => {
      // The most common production recovery case: a process crash
      // between the original evaluateRound (which persisted the
      // round WITHOUT correctAnswer due to L3) and the DB write.
      // The recovery runner:
      //   1. Sees recoveryRound.correctAnswer === "" (stripped).
      //   2. Calls questionService.findOne(round.question.id).
      //   3. Uses the returned correctAnswer with
      //      eliminationsForRound() to derive the eliminated set.
      const round = {
        matchId: "match-1",
        roundNo: 1,
        question: { id: "q-rehydrate", content: "Q?", options: ["A", "B"] },
        startedAt: 100,
        endsAt: 1000,
        answers: new Map<
          string,
          { answer: string; isCorrect: boolean; responseTimeMs: number }
        >([
          ["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }],
          ["p2", { answer: "B", isCorrect: false, responseTimeMs: 200 }],
        ]),
        status: "COMPLETED",
        correctAnswer: "",
        startingPlayers: ["p1", "p2"],
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_EVALUATING,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => round,
        getEventLog: () => [],
        transition: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      // The answer key is rehydrated from the Question DB row.
      vi.mocked(questionService.findOne).mockResolvedValueOnce({
        id: "q-rehydrate",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      } as any);
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound("match-1", "room-1", mockServer);

      // findOne was consulted because the persisted correctAnswer
      // was empty (L3 invariant — sensitive answer is never stored).
      expect(questionService.findOne).toHaveBeenCalledWith("q-rehydrate");
      // The rehydrated answer is what makes the eliminated set
      // match the original evaluation: p2 answered "B" (wrong)
      // against correctAnswer "A" → p2 is eliminated.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.objectContaining({
          matchId: "match-1",
          roundNo: 1,
          correctAnswer: "A",
          eliminatedPlayerIds: ["p2"],
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.PLAYER_ELIMINATED,
        expect.objectContaining({ playerId: "p2" }),
      );
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
    });

    it("Test D: Recovery with missing question in DB derives eliminatedIds from survivingSet", async () => {
      // The Question row is gone (TTL'd, or deleted). The runner
      // logs the rehydration failure, then falls into the
      // `!correctAnswer` branch which derives eliminatedIds from
      // `state.survivingPlayerIds`. This is a degraded mode that
      // still gives a usable eliminated set for ROUND_ENDED, even
      // though we lost the per-answer correctness detail.
      const round = {
        matchId: "match-1",
        roundNo: 1,
        question: { id: "q-missing", content: "Q?", options: ["A", "B"] },
        startedAt: 100,
        endsAt: 1000,
        answers: new Map<
          string,
          { answer: string; isCorrect: boolean; responseTimeMs: number }
        >([["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }]]),
        status: "COMPLETED",
        correctAnswer: "",
        startingPlayers: ["p1", "p2"],
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_EVALUATING,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => round,
        getEventLog: () => [],
        transition: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      // findOne returns null → correctAnswer stays "".
      vi.mocked(questionService.findOne).mockResolvedValueOnce(null as any);
      const warnSpy = vi.spyOn((runner as any).logger, "warn");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound("match-1", "room-1", mockServer);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to rehydrate correctAnswer in recovery: question q-missing not found in DB for match match-1 round 1",
        ),
      );
      // p1 is in survivingPlayerIds, p2 is not → p2 derived-eliminated.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.objectContaining({
          matchId: "match-1",
          roundNo: 1,
          correctAnswer: "",
          eliminatedPlayerIds: ["p2"],
        }),
      );
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
    });

    it("Test E: Recovery with both correctAnswer and startingPlayers — falls through to eliminationsForRound", async () => {
      // The `else` arm in the recovery handler: correctAnswer is
      // already on the in-memory round (e.g. the original process
      // did not crash, but the runner is being called via a
      // re-entry of endRound somehow), and startingPlayers is a
      // string[]. The runner must call eliminationsForRound and
      // NOT touch questionService.findOne.
      const round = {
        matchId: "match-1",
        roundNo: 1,
        question: { id: "q-both", content: "Q?", options: ["A", "B"] },
        startedAt: 100,
        endsAt: 1000,
        answers: new Map<
          string,
          { answer: string; isCorrect: boolean; responseTimeMs: number }
        >([
          ["p1", { answer: "A", isCorrect: true, responseTimeMs: 100 }],
          ["p2", { answer: "B", isCorrect: false, responseTimeMs: 200 }],
        ]),
        status: "COMPLETED",
        correctAnswer: "A",
        startingPlayers: ["p1", "p2"],
      };
      const fakeStateMachine = {
        getState: () => ({
          status: MatchStatus.ROUND_EVALUATING,
          currentRoundNo: 1,
          survivingPlayerIds: ["p1"],
          players: new Map([
            ["p1", { id: "p1", name: "Player 1" }],
            ["p2", { id: "p2", name: "Player 2" }],
          ]),
        }),
        getCurrentRound: () => round,
        getEventLog: () => [],
        transition: vi.fn(),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        fakeStateMachine,
      );
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await (runner as any).endRound("match-1", "room-1", mockServer);

      // findOne is NOT consulted because the correctAnswer was
      // already present on the in-memory round.
      expect(questionService.findOne).not.toHaveBeenCalled();
      // eliminationsForRound ran with the real correctAnswer and
      // startingPlayers → p2 eliminated.
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROUND_ENDED,
        expect.objectContaining({
          matchId: "match-1",
          roundNo: 1,
          correctAnswer: "A",
          eliminatedPlayerIds: ["p2"],
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.PLAYER_ELIMINATED,
        expect.objectContaining({ playerId: "p2" }),
      );
      expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
    });
  });

  describe("B1.1 public finish-guard facade", () => {
    it("isMatchFinishing returns false when no finish is in flight", () => {
      expect(runner.isMatchFinishing("match-99")).toBe(false);
    });

    it("isMatchFinishing returns true once finishMatchLoop acquires the guard", async () => {
      let resolveFinish: () => void = () => {};
      const finishPromise = new Promise<void>((resolve) => {
        resolveFinish = resolve;
      });
      // Keep finishMatchLoopInner hanging until we are ready.
      vi.spyOn(runner as any, "finishMatchLoopInner").mockReturnValue(
        finishPromise,
      );

      // Kick off finishMatchLoop but don't await — it is still running.
      const p = (runner as any).finishMatchLoop(
        "match-1",
        "room-1",
        mockServer,
      );
      // Flush microtasks so beginFinish() is called inside the async body.
      await Promise.resolve();

      expect(runner.isMatchFinishing("match-1")).toBe(true);

      // Resolve the promise to clean up.
      resolveFinish();
      await p;
    });

    it("awaitFinish resolves immediately when no finish is in flight", async () => {
      await expect(runner.awaitFinish("match-99")).resolves.toBeUndefined();
    });
  });
});
