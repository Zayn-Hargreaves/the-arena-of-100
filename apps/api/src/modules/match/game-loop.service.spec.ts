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
  RoomError,
} from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, it, expect, describe } from "vitest";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";

// B3 fix: GameLoopService now takes a `PrismaService` so it can open
// a `SELECT ... FOR UPDATE` transaction inside `launchRoomMatch`.
// Tests construct the service directly (no Nest DI), so we provide a
// minimal mock here. The default implementation makes
// `tx.$queryRaw` return a sensible "room exists, launchable" row
// so the existing launchRoomMatch tests pass without per-test
// setup. B3-specific tests override `__tx.$queryRaw` to drive the
// race scenarios (e.g. set `currentMatchId` to simulate a losing
// race).
function createMockPrismaService() {
  const txStub = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: "r1", status: RoomStatus.WAITING, currentMatchId: null },
      ]),
    room: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    $transaction: vi
      .fn()
      .mockImplementation(
        async <T>(fn: (tx: typeof txStub) => Promise<T>): Promise<T> => {
          return fn(txStub);
        },
      ),
    $queryRaw: vi.fn().mockResolvedValue([]),
    match: {
      delete: vi.fn().mockResolvedValue({}),
    },
    // Tests that need to drive the tx client pull this out.
    __tx: txStub,
  };
}

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
      createMockPrismaService() as any,
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

  // ---- handleMatchPlayerLeft (C1) ----
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

      await service.handleMatchPlayerLeft(
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

      await service.handleMatchPlayerLeft(
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

    it("should log string rejections in the endRound timeout callback", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      (service as any).usedQuestionIds.set("match-endround-string", new Set());
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
      vi.spyOn(service as any, "endRound").mockImplementationOnce(() => {
        throw "endRound failure (string)";
      });

      await (service as any).executeRound(
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

      await (service as any).endRound("match-bypass", "room-1", mockServer);

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

      await (service as any).endRound("match-bypass-2", "room-1", mockServer);

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

      const usedQuestionIds = (service as any).usedQuestionIds as Map<
        string,
        Set<string>
      >;
      const getSpy = vi.spyOn(usedQuestionIds, "get");
      getSpy.mockImplementationOnce(() => undefined);
      getSpy.mockImplementationOnce(() => new Set());

      stateMachine.transition(MatchStatus.COUNTDOWN);
      await (service as any).executeRound("match-unique", "room-1", mockServer);

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

      await (service as any).endRound(
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
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
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
      vi.spyOn(service as any, "checkMatchEnd").mockImplementationOnce(() => {
        throw "boom-string";
      });

      await (service as any).endRound(
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
        .spyOn(service as any, "endRound")
        .mockResolvedValue(undefined);

      await service.checkEarlyTermination(
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
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

      await expect(
        service.startMatchLoop("match-nonexistent", "room-1", mockServer),
      ).rejects.toThrow(RoomError);

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
          service as unknown as {
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
      (service as any).finishingMatches.add("match-1");
      try {
        await (service as any).finishMatchLoop("match-1", "room-1", mockServer);

        // No DB write, no broadcast, no state transition.
        expect(matchService.finishMatch).not.toHaveBeenCalled();
        expect(matchService.persistStateMachine).not.toHaveBeenCalled();
        expect(emitSpy).not.toHaveBeenCalledWith(
          ServerEvent.MATCH_FINISHED,
          expect.anything(),
        );
      } finally {
        (service as any).finishingMatches.delete("match-1");
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
      expect(service.isMatchFinishing("match-1")).toBe(false);

      // Manually mark the Set (simulating "currently in flight")
      // and assert isMatchFinishing flips.
      (service as any).finishingMatches.add("match-1");
      expect(service.isMatchFinishing("match-1")).toBe(true);
      (service as any).finishingMatches.delete("match-1");
      expect(service.isMatchFinishing("match-1")).toBe(false);

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

      await (service as any).finishMatchLoop("match-1", "room-1", mockServer);

      // After the call returns, the Set should no longer contain
      // the matchId. This is critical: a thrown DB error inside
      // finishMatchLoop must not lock the match out of future
      // finish attempts.
      expect((service as any).finishingMatches.has("match-1")).toBe(false);
      expect(service.isMatchFinishing("match-1")).toBe(false);

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
        (service as any).finishMatchLoop("match-1", "room-1", mockServer),
      ).rejects.toThrow("DB down");

      expect((service as any).finishingMatches.has("match-1")).toBe(false);
      expect(service.isMatchFinishing("match-1")).toBe(false);

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

      await (service as any).finishMatchLoop("match-1", "room-1", mockServer);

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
        createMockPrismaService() as any,
      );
      return { svc, redis, multiSpy };
    }

    // ---- getCountdownEnd ----
    describe("getCountdownEnd", () => {
      it("returns null when no countdown is active for the room", async () => {
        // H4 fix follow-up: getCountdownEnd is now async because it
        // falls back to Redis. The test awaits the returned promise.
        expect(await service.getCountdownEnd("r1")).toBeNull();
      });

      it("returns the recorded countdownEndsAt for an active countdown", async () => {
        const endsAt = Date.now() + 10_000;
        (service as any).lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: endsAt,
        });
        // H4 fix: same async-aware assertion.
        expect(await service.getCountdownEnd("r1")).toBe(endsAt);
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
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
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

        // B3 fix: launchRoomMatch now uses `prisma.$transaction` with
        // a `SELECT ... FOR UPDATE` for the atomic guard. The default
        // mock (see `createMockPrismaService`) returns a valid room
        // row, which lets the transaction commit and `createMatch`
        // run as before.
        const prisma = (service as any).prisma;
        const txUpdateSpy = vi.spyOn(prisma.__tx.room, "update");

        const match = await (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        });

        expect(match).toEqual({ id: "m1" });
        // B3 fix: the STARTING transition is now performed inside
        // the transaction (tx.room.update) so a concurrent caller
        // racing on the same roomId is rejected by the lock. The
        // old `roomService.updateRoomStatus(r1, STARTING)` call is
        // no longer made for the launch transition; that path now
        // only runs in the rollback branch below.
        expect(txUpdateSpy).toHaveBeenCalledWith({
          where: { id: "r1" },
          data: { status: RoomStatus.STARTING },
        });
        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.MATCH_STARTING,
          expect.objectContaining({ matchId: "m1" }),
        );
        expect(startLoopSpy).toHaveBeenCalledWith("m1", "r1", mockServer);
      });

      it("rolls back to WAITING and re-broadcasts ROOM_STATUS_UPDATED if createMatch throws", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
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

        // B3 fix: after the transaction commits (status=STARTING)
        // and createMatch throws, we revert the room status to
        // WAITING via the existing rollback path. The revert
        // itself still uses `roomService.updateRoomStatus` so the
        // existing assertion continues to hold.
        expect(roomService.updateRoomStatus).toHaveBeenLastCalledWith(
          "r1",
          RoomStatus.WAITING,
          null,
        );
        const rollback = emitSpy.mock.calls.find(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollback).toBeDefined();
      });

      // B3 fix: the old test asserted the "re-fetched room is no
      // longer launchable" race via `roomService.getRoom`. With the
      // `SELECT ... FOR UPDATE` transaction, the launchability
      // check happens inside the transaction against the locked
      // row. This new test overrides `tx.$queryRaw` to return a
      // row that is no longer launchable, asserting the
      // `ROOM_ALREADY_STARTED` path is still taken.
      it("B3: throws ROOM_ALREADY_STARTED when the locked row is no longer launchable (race)", async () => {
        const prisma = (service as any).prisma;
        // Simulate the case where, by the time we acquire the
        // FOR UPDATE lock, the room has already been transitioned
        // to STARTING by a previous launch.
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
          {
            id: "r1",
            status: RoomStatus.STARTING,
            currentMatchId: null,
          },
        ]);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
      });

      // B3 fix: same race, but the room still shows WAITING in the
      // outer fetch yet the previous launcher already set
      // `currentMatchId`. The transaction's currentMatchId check
      // catches this even though the status check would have passed.
      it("B3: throws ROOM_ALREADY_STARTED when the locked row has a non-null currentMatchId (race)", async () => {
        const prisma = (service as any).prisma;
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
          {
            id: "r1",
            status: RoomStatus.WAITING,
            currentMatchId: "m-already-running",
          },
        ]);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
      });

      // B3 fix: the FOR UPDATE row is missing (room was deleted
      // between outer read and lock acquisition). The transaction
      // throws ROOM_NOT_FOUND so the caller gets a typed error.
      it("B3: throws ROOM_NOT_FOUND when the FOR UPDATE row is missing", async () => {
        const prisma = (service as any).prisma;
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([]);

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
      });

      // B3 race-lost guard (finding from code review, 2026-06-14):
      // when the inner `tx.$queryRaw FOR UPDATE` throws
      // `ROOM_ALREADY_STARTED` (lock holder saw a non-WAITING/
      // COUNTDOWN status or a non-null `currentMatchId`),
      // another thread has already validly acquired the room
      // lock and set `status = STARTING` (or further) in their
      // own transaction. The previous unconditional rollback
      // in the outer `catch` would overwrite the winner's
      // `STARTING` with `WAITING` + emit
      // `ROOM_STATUS_UPDATED {WAITING}` to every connected
      // client — corrupting the winner's state and confusing
      // all spectators/players in the room channel.
      //
      // The new guard detects the race-lost error and skips
      // BOTH the revert AND the emit. Only the original
      // `ROOM_ALREADY_STARTED` error is propagated to the
      // caller (admin tooling / host force-start / auto-start
      // timer) so they can report "someone else got there
      // first" without us silently destroying the winner.
      it("B3 race-lost: does NOT revert room status when the lock-holder reports ROOM_ALREADY_STARTED", async () => {
        const prisma = (service as any).prisma;
        // Simulate the case where, by the time we acquired the
        // FOR UPDATE lock, the room's status had already moved
        // out of the launchable range (e.g. another thread set
        // `status = STARTING` in their transaction and committed
        // before our lock was released).
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
          {
            id: "r1",
            status: RoomStatus.STARTING,
            currentMatchId: null,
          },
        ]);
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

        // CRITICAL: no revert of the room status to WAITING.
        // The winning thread's STARTING state is preserved.
        expect(updateRoomStatusSpy).not.toHaveBeenCalled();
        // CRITICAL: no `ROOM_STATUS_UPDATED` broadcast. We
        // must not announce a state that the winning thread
        // didn't author.
        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollbackEmits).toHaveLength(0);
      });

      // Same race-lost guard for the inner `createMatch` catch
      // (defense-in-depth — `createMatch` currently doesn't
      // throw `ROOM_ALREADY_STARTED` directly, but if a future
      // refactor routes the FOR UPDATE check through it, the
      // same protection must apply).
      it("B3 race-lost (createMatch): does NOT revert room status when createMatch throws ROOM_ALREADY_STARTED", async () => {
        // The transaction guard passes (room is launchable), so
        // we reach `createMatch`. `createMatch` then throws the
        // race-lost error directly (e.g. a future refactor that
        // moves the FOR UPDATE check inside `createMatch`).
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);
        // The matchService mock from beforeEach has no
        // `createMatch` field; tests that need it attach a
        // vi.fn() to the object (matching the pattern used
        // elsewhere in this file). The vi.fn() exposes
        // `mockRejectedValueOnce` for the race-lost assertion.
        (matchService.createMatch as any) = vi
          .fn()
          .mockRejectedValueOnce(new RoomError(ErrorCode.ROOM_ALREADY_STARTED));
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

        // The winning thread's STARTING/IN_GAME state must
        // NOT be clobbered.
        expect(updateRoomStatusSpy).not.toHaveBeenCalled();
        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollbackEmits).toHaveLength(0);
      });

      // The B3 cleanup's inner createError catch wraps the
      // revert in a nested try/catch (lines 625-630). If
      // `createMatch` throws AND `roomService.updateRoomStatus`
      // (the revert) also throws, we hit the nested
      // `catch (revertError)` branch and log a fallback error.
      // This is a rare double-failure (DB down + Redis down at
      // the same time) but the test pins the logging path so a
      // future refactor can't drop the fallback silently.
      it("B3 nested cleanup: logs the secondary error when both createMatch AND the revert throw", async () => {
        // Default mock makes the FOR UPDATE pass (valid launchable
        // row). createMatch then throws a non-race error.
        (matchService.createMatch as any) = vi
          .fn()
          .mockRejectedValueOnce(new Error("primary failure: DB down"));
        // The revert path itself also throws. This is the
        // double-failure scenario.
        vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
          new Error("revert failure: DB still down"),
        );
        const errorSpy = vi.spyOn((service as any).logger, "error");

        // We expect the original `createError` to be rethrown.
        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("primary failure: DB down");

        // The nested catch (revertError) must have logged the
        // fallback message. We assert the message substring so a
        // future wording change in the log doesn't break the
        // test, but the structural property (the error log fired)
        // is pinned.
        const revertLogCall = errorSpy.mock.calls.find((call) =>
          String(call[0]).includes(
            "Failed to revert Room r1 status to WAITING",
          ),
        );
        expect(revertLogCall).toBeDefined();
      });

      it("B3 nested cleanup: logs the secondary error when both createMatch AND the revert throw a non-Error object", async () => {
        (matchService.createMatch as any) = vi
          .fn()
          .mockRejectedValueOnce(new Error("primary failure: DB down"));
        vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
          "revert failure string",
        );
        const errorSpy = vi.spyOn((service as any).logger, "error");

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("primary failure: DB down");

        const revertLogCall = errorSpy.mock.calls.find((call) =>
          String(call[0]).includes(
            "Failed to revert Room r1 status to WAITING",
          ),
        );
        expect(revertLogCall).toBeDefined();
        expect(revertLogCall?.[1]).toBeUndefined();
      });

      it("reverts room status and deletes orphaned match when startMatchLoop throws an error", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        (matchService.createMatch as any) = vi
          .fn()
          .mockResolvedValue({ id: "m1" });

        vi.spyOn(service as any, "startMatchLoop").mockRejectedValueOnce(
          new Error("startMatchLoop failed"),
        );

        const prisma = (service as any).prisma;
        const matchDeleteSpy = vi.spyOn(prisma.match, "delete");
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("startMatchLoop failed");

        // Should clean up the orphaned match
        expect(matchDeleteSpy).toHaveBeenCalledWith({
          where: { id: "m1" },
        });

        // Should revert the room status to WAITING
        expect(updateRoomStatusSpy).toHaveBeenCalledWith(
          "r1",
          RoomStatus.WAITING,
          null,
        );

        // Should emit ROOM_STATUS_UPDATED with WAITING and null match ID
        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING &&
            (call[1] as { currentMatchId: string | null }).currentMatchId ===
              null,
        );
        expect(rollbackEmits).toHaveLength(1);
      });
    });

    // ---- onModuleInit recovery ----
    describe("onModuleInit (lobby countdown recovery)", () => {
      it("returns immediately when recovery is already in flight", async () => {
        (service as any).recoveryInFlight = true;
        const smembersSpy = vi.spyOn(
          (service as any).redis.getClient(),
          "smembers",
        );

        await service.onModuleInit();

        expect(smembersSpy).not.toHaveBeenCalled();
        (service as any).recoveryInFlight = false;
      });

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

      it("buffers expired countdowns into pendingRecovery when no server is wired up (C4)", async () => {
        // C4 fix: the previous behaviour was to silently clear the
        // persisted entry when the recovered countdown had expired
        // but the server was not yet wired up. That left the room
        // stuck in COUNTDOWN forever and the next restart would
        // re-issue the same warning, looping the broken state.
        //
        // New behaviour: the recovery is buffered in
        // `pendingRecovery` and replayed by `drainPendingRecovery`
        // the moment `setServer` is called. No Redis state is
        // touched on the no-server path.
        const pastEnd = Date.now() - 1000;
        const { svc, multiSpy } = buildService({
          smembers: ["rExpiredNoServer"],
          get: String(pastEnd),
        });
        // No setServer call → server is undefined

        await svc.onModuleInit();

        // The recovery was buffered, NOT cleared.
        expect((svc as any).pendingRecovery).toEqual([
          {
            roomId: "rExpiredNoServer",
            countdownEndsAt: pastEnd,
            expired: true,
          },
        ]);
        // The Redis multi() path was NOT used — the persisted entry
        // stays in place until setServer drains the buffer.
        expect(multiSpy).not.toHaveBeenCalled();
      });

      it("drains pendingRecovery when setServer is called (C4)", async () => {
        // C4 fix: pendingRecovery entries are replayed through
        // launchRoomMatch / armLobbyCountdownTimer the moment
        // setServer is called. This test exercises the expired path
        // (room launches immediately) and the unexpired path
        // (room re-arms its timer).
        const now = Date.now();
        const pastEnd = now - 1000;
        const futureEnd = now + 60_000;
        const { svc, redis } = buildService({
          smembers: ["rExpired", "rFuture"],
        });
        // mockImplementation lets us return a different value per
        // key, which the two roomIds in smembers require.
        vi.mocked(redis.getClient().get).mockImplementation(
          async (key: string) => {
            if (typeof key !== "string") return null;
            if (key.endsWith("rExpired")) return String(pastEnd);
            if (key.endsWith("rFuture")) return String(futureEnd);
            return null;
          },
        );

        await svc.onModuleInit();
        expect((svc as any).pendingRecovery).toHaveLength(2);

        const launchSpy = vi
          .spyOn(svc as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });

        svc.setServer(mockServer as unknown as Server);
        await Promise.resolve();

        // The buffer is drained atomically.
        expect((svc as any).pendingRecovery).toEqual([]);
        // Expired entry → launchRoomMatch was called.
        expect(launchSpy).toHaveBeenCalledWith("rExpired", mockServer, {
          isAutoStart: true,
        });
        // Future entry → the lobbyCountdowns map was populated.
        expect((svc as any).lobbyCountdowns.has("rFuture")).toBe(true);
      });

      it("onModuleInit after setServer does not re-buffer (C4)", async () => {
        // Sanity: once setServer has been called, `this.server` is
        // truthy. A subsequent onModuleInit must use the direct
        // launch / arm paths, NOT re-buffer. Re-buffering would mean
        // the buffer grows unbounded across multiple re-inits.
        const pastEnd = Date.now() - 1000;
        const { svc, redis } = buildService({
          smembers: ["rExpired"],
        });
        vi.mocked(redis.getClient().smembers).mockResolvedValue(["rExpired"]);
        vi.mocked(redis.getClient().get).mockImplementation(
          async (key: string) => {
            if (typeof key !== "string") return null;
            if (key.endsWith("rExpired")) return String(pastEnd);
            return null;
          },
        );
        const launchSpy = vi
          .spyOn(svc as any, "launchRoomMatch")
          .mockResolvedValue({ id: "m1" });

        // First recovery (no server) → buffer populated.
        await svc.onModuleInit();
        expect((svc as any).pendingRecovery).toHaveLength(1);

        // setServer drains the buffer; server is now set.
        svc.setServer(mockServer as unknown as Server);
        await Promise.resolve();
        expect(launchSpy).toHaveBeenCalledTimes(1);
        expect((svc as any).pendingRecovery).toEqual([]);

        // Second recovery (server set) → launches directly, no
        // re-buffer. The buffer stays empty and launch is called a
        // second time (idempotency is launchRoomMatch's own
        // responsibility, tested elsewhere).
        await svc.onModuleInit();
        await Promise.resolve();
        expect(launchSpy).toHaveBeenCalledTimes(2);
        expect((svc as any).pendingRecovery).toEqual([]);
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

      it("returns null when a countdown slot exists but the stored entry vanished", async () => {
        const countdowns = (service as any).lobbyCountdowns as Map<
          string,
          { timer: NodeJS.Timeout; countdownEndsAt: number }
        >;
        countdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        const getSpy = vi
          .spyOn(countdowns, "get")
          .mockReturnValueOnce(undefined);

        const result = await service.maybeStartPublicCountdown(
          "r1",
          mockServer,
        );

        expect(result).toBeNull();
        expect(getSpy).toHaveBeenCalledWith("r1");
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
          createMockPrismaService() as any,
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

      it("logs and swallows non-Error rejections thrown by clearPersistedCountdown (string DEL chain fail)", async () => {
        const redis = createMockRedisService() as any;
        const multiSpy = vi.fn(() => {
          const mockMulti: any = {};
          mockMulti.set = vi.fn().mockReturnValue(mockMulti);
          mockMulti.del = vi.fn().mockReturnValue(mockMulti);
          mockMulti.sadd = vi.fn().mockReturnValue(mockMulti);
          mockMulti.srem = vi.fn().mockReturnValue(mockMulti);
          mockMulti.exec = vi.fn().mockRejectedValueOnce("redis down (string)");
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
          createMockPrismaService() as any,
        );
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        await (svc as any).clearPersistedCountdown("r1");

        expect(multiSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Failed to clear persisted countdown for room r1: redis down (string)",
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

      it("onModuleInit does not touch Redis when the no-server path is taken (C4)", async () => {
        // C4 fix follow-up: previously, when the countdown had expired
        // and the server was not yet wired up, the service issued a
        // fire-and-forget `clearPersistedCountdown` call. That call
        // could fail and would have been logged via .catch(). With the
        // C4 fix, no clearPersistedCountdown call is made on the
        // no-server path — the recovery is buffered instead. This
        // test pins the new contract.
        const pastEnd = Date.now() - 1000;
        const { svc } = buildService({
          smembers: ["rExpiredNoServer"],
          get: String(pastEnd),
        });
        const clearSpy = vi.spyOn(svc as any, "clearPersistedCountdown");
        const errorSpy = vi.spyOn((svc as any).logger, "error");

        await svc.onModuleInit();
        await Promise.resolve();
        await Promise.resolve();

        // The clear path is not invoked on the no-server path.
        expect(clearSpy).not.toHaveBeenCalled();
        // No error is logged because no call rejected.
        expect(errorSpy).not.toHaveBeenCalledWith(
          expect.stringContaining("Failed to clear persisted countdown"),
          expect.any(Error),
        );
        // The recovery was buffered for later drain.
        expect((svc as any).pendingRecovery).toEqual([
          {
            roomId: "rExpiredNoServer",
            countdownEndsAt: pastEnd,
            expired: true,
          },
        ]);
      });

      it("launchRoomMatch throws ROOM_ALREADY_STARTED when the re-fetched room is no longer launchable (race)", async () => {
        // B3 fix: the previous version of this test drove the race
        // via a second `roomService.getRoom` call. The new code
        // reads the launchable status inside the
        // `SELECT ... FOR UPDATE` transaction, so we drive the race
        // by returning an IN_GAME row from `tx.$queryRaw`.
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });
        const prisma = (service as any).prisma;
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
          {
            id: "r1",
            status: RoomStatus.IN_GAME,
            currentMatchId: "m-existing",
          },
        ]);
        (matchService.createMatch as any) = vi.fn();

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

        // createMatch must NOT be called — the FOR UPDATE guard
        // prevents a double-start.
        expect(matchService.createMatch).not.toHaveBeenCalled();
        // B3 race-lost guard (code review 2026-06-14): the
        // winning thread has already set `status = STARTING` /
        // `IN_GAME` in their own transaction. We MUST NOT
        // overwrite that with `WAITING` — that would clobber
        // the winner's state and confuse every connected
        // client. The old "rollback to WAITING" expectation is
        // intentionally removed.
        expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
      });
    });

    // ============================================================
    // Admin kill-switch: stopRoomRuntime + emitRoomTerminated (PR #47)
    // ============================================================
    describe("Admin kill-switch helpers (PR #47)", () => {
      // ---- stopRoomRuntime ----
      describe("stopRoomRuntime", () => {
        it("clears the lobby countdown timer, removes the in-memory slot, and runs clearPersistedCountdown", async () => {
          const { svc, multiSpy } = buildService();
          // Seed an active lobby countdown
          (svc as any).lobbyCountdowns.set("r1", {
            timer: setTimeout(() => undefined, 100),
            countdownEndsAt: Date.now() + 5000,
          });

          await svc.stopRoomRuntime("r1", null);

          // In-memory slot cleared
          expect((svc as any).lobbyCountdowns.has("r1")).toBe(false);
          // clearPersistedCountdown fires the multi() chain
          expect(multiSpy).toHaveBeenCalled();
        });

        it("calls cancelMatchLoop when a matchId is provided (no countdown active)", async () => {
          const { svc } = buildService();
          // Seed match-level state so we can assert cancellation
          (svc as any).usedQuestionIds.set("m1", new Set(["q1"]));
          (svc as any).activeTimers.set(
            "m1",
            new Set([setTimeout(() => undefined, 100)]),
          );

          await svc.stopRoomRuntime("r2", "m1");

          // match-level state was cleared
          expect((svc as any).usedQuestionIds.has("m1")).toBe(false);
          expect((svc as any).activeTimers.has("m1")).toBe(false);
        });

        it("is a no-op for runtime state when neither countdown nor matchId are present", async () => {
          const { svc } = buildService();

          // Should not throw
          await expect(
            svc.stopRoomRuntime("r3", null),
          ).resolves.toBeUndefined();
        });

        it("cancels match state when matchId is provided even with an active countdown", async () => {
          const { svc } = buildService();
          (svc as any).lobbyCountdowns.set("r4", {
            timer: setTimeout(() => undefined, 100),
            countdownEndsAt: Date.now() + 5000,
          });
          (svc as any).usedQuestionIds.set("m4", new Set(["q1"]));

          await svc.stopRoomRuntime("r4", "m4");

          // Both layers cleaned
          expect((svc as any).lobbyCountdowns.has("r4")).toBe(false);
          expect((svc as any).usedQuestionIds.has("m4")).toBe(false);
        });
      });

      // ---- emitRoomTerminated ----
      describe("emitRoomTerminated", () => {
        it("emits ROOM_TERMINATED to the room channel when server is wired up", () => {
          const { svc } = buildService();
          const emitSpy = vi.fn();
          const toSpy = vi.fn().mockReturnValue({ emit: emitSpy });
          (svc as any).setServer({ to: toSpy } as unknown as Server);

          svc.emitRoomTerminated("r1", {
            matchId: "m1",
            message: "Abandoned by host",
          });

          expect(toSpy).toHaveBeenCalledWith(expect.stringContaining("r1"));
          expect(emitSpy).toHaveBeenCalledWith(
            ServerEvent.ROOM_TERMINATED,
            expect.objectContaining({
              roomId: "r1",
              reason: "ADMIN_TERMINATED",
              matchId: "m1",
              message: "Abandoned by host",
            }),
          );
          // terminatedAt is a number
          const payload = emitSpy.mock.calls[0][1] as {
            terminatedAt: number;
          };
          expect(typeof payload.terminatedAt).toBe("number");
        });

        it("emits ROOM_TERMINATED with null matchId and undefined message when only the room is provided", () => {
          const { svc } = buildService();
          const emitSpy = vi.fn();
          const toSpy = vi.fn().mockReturnValue({ emit: emitSpy });
          (svc as any).setServer({ to: toSpy } as unknown as Server);

          svc.emitRoomTerminated("r2", { matchId: null });

          expect(emitSpy).toHaveBeenCalledWith(
            ServerEvent.ROOM_TERMINATED,
            expect.objectContaining({
              roomId: "r2",
              reason: "ADMIN_TERMINATED",
              matchId: null,
              message: undefined,
            }),
          );
        });

        it("logs a warning and does NOT emit when server has not been wired up", () => {
          // No setServer() call → server is undefined
          const { svc } = buildService();
          const warnSpy = vi.spyOn((svc as any).logger, "warn");

          // Should not throw
          expect(() =>
            svc.emitRoomTerminated("r3", { matchId: null }),
          ).not.toThrow();

          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(
              "emitRoomTerminated: server not set, cannot emit for room r3",
            ),
          );
        });
      });
    });
  });

  // ============================================================
  // PR #50 patch coverage — Codecov flagged 19 missing lines
  // across these branches. Each `it` block below pins ONE
  // new branch introduced by the B1 / B2 / B3 / C4 / H1 / H3 /
  // H4 / H5 / L6 / M5 race-and-recovery hardening on this PR.
  // Grouped by file region so a future regression points
  // straight at the relevant cluster.
  // ============================================================
  describe("PR #50 patch coverage — new race/recovery branches", () => {
    // ---- C4: drainPendingRecovery (setServer-side) ----
    describe("drainPendingRecovery", () => {
      it("returns early when the buffer is empty (no work to do)", async () => {
        // New branch: `if (this.pendingRecovery.length === 0) return;`
        // at game-loop.service.ts:109. Calling setServer on a fresh
        // service must not invoke armLobbyCountdownTimer or
        // launchRoomMatch.
        const armSpy = vi.spyOn(service as any, "armLobbyCountdownTimer");
        const launchSpy = vi.spyOn(service as any, "launchRoomMatch");

        service.setServer(mockServer as unknown as Server);
        await Promise.resolve();

        expect(armSpy).not.toHaveBeenCalled();
        expect(launchSpy).not.toHaveBeenCalled();
        expect((service as any).pendingRecovery).toEqual([]);
      });

      it("logs and swallows a launch failure for an expired entry in the buffer", async () => {
        // New branch: the .catch() on the fire-and-forget
        // `void this.launchRoomMatch(...)` inside drainPendingRecovery
        // for `entry.expired === true` (game-loop.service.ts:119-123).
        // Pin the contract: a rejected launchRoomMatch must NOT
        // bubble up; the error is logged at error level.
        const launchError = new Error("drain launch boom");
        vi.spyOn(service as any, "launchRoomMatch").mockRejectedValue(
          launchError,
        );
        (service as any).pendingRecovery.push({
          roomId: "rExpired",
          countdownEndsAt: Date.now() - 1000,
          expired: true,
        });
        const errorSpy = vi.spyOn((service as any).logger, "error");

        service.setServer(mockServer as unknown as Server);
        // Flush the void promise chain several times — the
        // rejected promise is detached.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
          "Pending-recovery launch failed for room rExpired:",
          launchError,
        );
        // The buffer is drained atomically even on the failure
        // path — we never leave the entry behind.
        expect((service as any).pendingRecovery).toEqual([]);
      });
    });

    // ---- C4: onModuleInit no-server, non-expired ----
    describe("onModuleInit no-server, non-expired branch", () => {
      it("buffers a NON-expired future countdown into pendingRecovery when no server is wired up", async () => {
        // New branch: the `else` arm of the `if (this.server)` check
        // in the non-expired arm of onModuleInit
        // (game-loop.service.ts:207-216). The expired no-server
        // arm is already covered by the existing C4 test; the
        // non-expired arm was missing.
        const futureEnd = Date.now() + 60_000;
        vi.mocked(
          (service as any).redis.getClient().smembers,
        ).mockResolvedValueOnce(["rFuture"] as any);
        vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
          String(futureEnd),
        );
        // No setServer call → server is undefined.

        await service.onModuleInit();

        expect((service as any).pendingRecovery).toEqual([
          {
            roomId: "rFuture",
            countdownEndsAt: futureEnd,
            expired: false,
          },
        ]);
      });
    });

    // ---- H4: getCountdownEnd Redis fallback ----
    describe("getCountdownEnd Redis fallback", () => {
      it("returns the parsed countdownEndsAt from Redis when in-memory is empty (Redis hit)", async () => {
        // New branch: the `client.get(...) → parse → return parsed`
        // happy path at game-loop.service.ts:391-394. The in-memory
        // hit path is already covered; the Redis hit path was not.
        const endsAt = Date.now() + 10_000;
        vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
          String(endsAt),
        );

        expect(await service.getCountdownEnd("r1")).toBe(endsAt);
      });

      it("returns null when Redis returns a non-numeric string (parseInt → NaN)", async () => {
        // New branch: the `Number.isFinite(parsed) ? parsed : null`
        // ternary at game-loop.service.ts:394. A corrupt Redis
        // payload must be treated as "no countdown" — the
        // alternative (return NaN and crash downstream arithmetic)
        // is worse.
        vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
          "not-a-number",
        );

        expect(await service.getCountdownEnd("r1")).toBeNull();
      });

      it("returns null and logs a warning when Redis throws", async () => {
        // New branch: the `catch (error)` arm at
        // game-loop.service.ts:395-402. A Redis outage must not
        // crash the WS handler that called `getCountdownEnd`
        // (e.g. AuthHandler.handleAuthenticate's reconnect path).
        vi.mocked((service as any).redis.getClient().get).mockRejectedValueOnce(
          new Error("redis down"),
        );
        const warnSpy = vi.spyOn((service as any).logger, "warn");

        expect(await service.getCountdownEnd("r1")).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "getCountdownEnd: Redis read failed for room r1: redis down",
          ),
        );
      });

      it("returns null and logs a warning when Redis throws a non-Error object (string)", async () => {
        vi.mocked((service as any).redis.getClient().get).mockRejectedValueOnce(
          "redis down string",
        );
        const warnSpy = vi.spyOn((service as any).logger, "warn");

        expect(await service.getCountdownEnd("r1")).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          "getCountdownEnd: Redis read failed for room r1: redis down string",
        );
      });
    });

    // ---- B3: launchRoomMatch OUTER catch race-lost guard ----
    describe("launchRoomMatch outer-catch race-lost guard", () => {
      it("does NOT revert room status when the FOR UPDATE row reports ROOM_ALREADY_STARTED (B3 race-lost)", async () => {
        // New branch: the OUTER `catch (error) { if (isRaceLost) ... }`
        // arm at game-loop.service.ts:662-669. The INNER catch's
        // race-lost guard (around createMatch) is already covered
        // by the "B3 race-lost (createMatch)" test; the outer
        // catch's guard — reached when the transaction itself
        // throws ROOM_ALREADY_STARTED (e.g. another thread
        // committed STARTING between our outer read and our
        // FOR UPDATE) — was missing.
        const prisma = (service as any).prisma;
        vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
          {
            id: "r1",
            status: RoomStatus.STARTING,
            currentMatchId: null,
          },
        ]);
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

        // CRITICAL: the outer catch's race-lost branch must NOT
        // call updateRoomStatus(WAITING) — the winning thread
        // owns the room and has already set it to STARTING.
        expect(updateRoomStatusSpy).not.toHaveBeenCalled();
        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollbackEmits).toHaveLength(0);
      });
    });

    // ---- M5: executeCountdown defence-in-depth ----
    describe("executeCountdown M5 defence-in-depth", () => {
      it("logs and skips executeRound when the state machine is gone in the timer callback", async () => {
        // New branch: the `if (!sm) { this.logger.log(...); return; }`
        // arm at game-loop.service.ts:768-774. The M5 fix is
        // defence-in-depth against a race where `stopRoomRuntime`
        // tears down the match between setTimeout firing and the
        // callback body reaching the state-machine lookup.
        vi.useFakeTimers();
        const executeRoundSpy = vi
          .spyOn(service as any, "executeRound")
          .mockResolvedValue(undefined);
        const logSpy = vi.spyOn((service as any).logger, "log");

        // Force the in-callback `getStateMachine` to return
        // undefined (simulating a torn-down match).
        vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
          undefined as any,
        );

        (service as any).executeCountdown("match-1", "room-1", mockServer);
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

    // ---- H3: endRound DB persistence failure rethrows ----
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
        const errorSpy = vi.spyOn((service as any).logger, "error");
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
          (service as any).endRound("match-1", "room-1", mockServer),
        ).rejects.toThrow("db connection reset");

        // The H3 fix guarantees the state machine is NOT
        // advanced to ROUND_RESULT — the next round timer
        // (or admin) can retry from ROUND_EVALUATING.
        expect(stateMachine.getState().status).toBe(
          MatchStatus.ROUND_EVALUATING,
        );
        expect(matchService.persistStateMachine).not.toHaveBeenCalled();
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

    // ---- B2: finishMatchLoopInner null-winner logging ----
    describe("finishMatchLoopInner null-winner logging", () => {
      it("logs a warning when finishMatchLoopInner completes with winnerId: null (B2)", async () => {
        // New branch: the `if (winnerId === null) { logger.warn(...) }`
        // arm at game-loop.service.ts:1237-1240. The existing
        // B2 test asserts the wire payload and the DB call,
        // but does NOT assert the log line. Operators rely
        // on this log to detect matches that finished with
        // an empty roster or unresolvable tie-break.
        vi.useFakeTimers();
        const warnSpy = vi.spyOn((service as any).logger, "warn");
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

        await (service as any).finishMatchLoop("match-1", "room-1", mockServer);

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

    // ---- H1: checkEarlyTermination explicit guard ----
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
          .spyOn(service as any, "endRound")
          .mockResolvedValue(undefined);

        // Pre-mark the matchId as already-ending.
        (service as any).endingRounds.add("match-1");
        try {
          await service.checkEarlyTermination(
            "match-1",
            "room-1",
            mockServer as unknown as Server,
          );
        } finally {
          (service as any).endingRounds.delete("match-1");
        }

        expect(endRoundSpy).not.toHaveBeenCalled();
        // We never even reach the state-machine lookup.
        expect(matchService.getStateMachine).not.toHaveBeenCalled();
      });
    });

    describe("launchRoomMatch orphaned match cleanup", () => {
      it("deletes the created match, reverts room status, and re-throws if startMatchLoop throws", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        (matchService.createMatch as any) = vi
          .fn()
          .mockResolvedValue({ id: "m1" });

        const loopError = new Error("loop initialization failed");
        vi.spyOn(service as any, "startMatchLoop").mockRejectedValueOnce(
          loopError,
        );

        const deleteSpy = vi
          .spyOn((service as any).prisma.match, "delete")
          .mockResolvedValueOnce({} as any);
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
        const warnSpy = vi.spyOn((service as any).logger, "warn");

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("loop initialization failed");

        expect(deleteSpy).toHaveBeenCalledWith({
          where: { id: "m1" },
        });
        expect(warnSpy).toHaveBeenCalledWith(
          "Deleting orphaned match m1 for room r1",
        );
        expect(updateRoomStatusSpy).toHaveBeenCalledWith(
          "r1",
          RoomStatus.WAITING,
          null,
        );

        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollbackEmits).toHaveLength(1);
      });

      it("logs at error level when deleting the orphaned match throws but still reverts room status and throws the original error", async () => {
        const emitSpy = vi.fn();
        (mockServer.to as any).mockReturnValue({ emit: emitSpy });

        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        (matchService.createMatch as any) = vi
          .fn()
          .mockResolvedValue({ id: "m1" });

        const loopError = new Error("loop initialization failed");
        vi.spyOn(service as any, "startMatchLoop").mockRejectedValueOnce(
          loopError,
        );

        const deleteError = new Error("delete failed");
        const deleteSpy = vi
          .spyOn((service as any).prisma.match, "delete")
          .mockRejectedValueOnce(deleteError);
        const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
        const errorSpy = vi.spyOn((service as any).logger, "error");

        await expect(
          (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          }),
        ).rejects.toThrow("loop initialization failed");

        expect(deleteSpy).toHaveBeenCalledWith({
          where: { id: "m1" },
        });
        expect(errorSpy).toHaveBeenCalledWith(
          "Failed to delete orphaned match m1:",
          deleteError,
        );
        expect(updateRoomStatusSpy).toHaveBeenCalledWith(
          "r1",
          RoomStatus.WAITING,
          null,
        );

        const rollbackEmits = emitSpy.mock.calls.filter(
          (call) =>
            call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
            (call[1] as { roomStatus: string }).roomStatus ===
              RoomStatus.WAITING,
        );
        expect(rollbackEmits).toHaveLength(1);
      });

      it("logs at error level and rethrows when launchRoomMatch primary failure is a non-Error object (string)", async () => {
        vi.mocked(roomService.getRoom).mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);

        (matchService.createMatch as any) = vi
          .fn()
          .mockRejectedValueOnce("primary string failure");

        const errorSpy = vi.spyOn((service as any).logger, "error");

        let thrownErr: any;
        try {
          await (service as any).launchRoomMatch("r1", mockServer, {
            isAutoStart: false,
          });
        } catch (err) {
          thrownErr = err;
        }

        expect(thrownErr).toBe("primary string failure");
        expect(errorSpy).toHaveBeenCalledWith(
          "Launch failed for room r1: primary string failure",
          undefined,
        );
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
        (service as any).usedQuestionIds.set("match-1", new Set());

        const endRoundSpy = vi.spyOn(service as any, "endRound");
        const checkMatchEndSpy = vi.spyOn(service as any, "checkMatchEnd");

        // 1. Call executeRound directly to transition to ROUND_ACTIVE and set the 15s endRound timer
        await (service as any).executeRound("match-1", "room-1", mockServer);

        // 2. Fast forward 15s to trigger the endRound timer callback
        await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);

        // Verify endRound was called through the timeout callback (line 957)
        expect(endRoundSpy).toHaveBeenCalledWith(
          "match-1",
          "room-1",
          mockServer,
        );

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
  });
});
