import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Server } from "socket.io";
import { GAME_CONFIG, MatchStatus, PlayerStatus } from "@arena/shared";
import { MatchStateMachine } from "@arena/game-core";
import { MatchRoundRunner } from "./match-round-runner";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";
import { MatchOwnershipService } from "./match-ownership.service";

// ============================================================
// B3a — resumeMatchLoop: rebuild a running match from persisted
// state and arm the correct next timer. The caller (B3b) supplies
// an already-hydrated + revalidated state machine; resumeMatchLoop
// never re-hydrates. These tests drive each persisted phase and
// assert the timer it arms fires the right callback at the right
// time (derived from the canonical `phaseEndsAt`, clamped).
// ============================================================

type FakeStateInput = Partial<{
  status: MatchStatus;
  phaseEndsAt: number | null;
  roundResultStartedAt: number | null;
  startedAt: number | null;
  survivingPlayerIds: string[];
}>;

/**
 * A minimal hydrated state machine for the arming tests: full control
 * over getState() (phaseEndsAt), getEventLog(), and getCurrentRound().
 * The exactly-once test below uses a real MatchStateMachine instead.
 */
function fakeStateMachine(
  input: FakeStateInput = {},
  eventLog: Array<{ type: string; payload?: unknown }> = [],
  currentRound: unknown = null,
): MatchStateMachine {
  const state = {
    id: "match-1",
    roomId: "room-1",
    status: input.status ?? MatchStatus.COUNTDOWN,
    currentRoundNo: 1,
    totalRounds: GAME_CONFIG.MAX_ROUNDS,
    players: new Map(),
    survivingPlayerIds: input.survivingPlayerIds ?? ["p1", "p2"],
    eliminatedPlayerIds: [],
    winnerId: null,
    startedAt: input.startedAt ?? 0,
    endedAt: null,
    phaseEndsAt: input.phaseEndsAt ?? null,
    roundResultStartedAt: input.roundResultStartedAt ?? null,
  };
  return {
    getState: () => state,
    getEventLog: () => eventLog.map((e) => ({ ...e, timestamp: 0, seqNo: 0 })),
    getCurrentRound: () => currentRound,
  } as unknown as MatchStateMachine;
}

describe("MatchRoundRunner.resumeMatchLoop (B3a)", () => {
  let runner: MatchRoundRunner;
  let matchService: MatchService;
  let questionService: QuestionService;
  let roomService: RoomService;
  let ownership: MatchOwnershipService;
  let disposeCommandStream: ReturnType<typeof vi.fn>;
  let mockServer: Server;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    matchService = {
      getStateMachine: vi.fn().mockResolvedValue(undefined),
      persistStateMachine: vi.fn().mockResolvedValue("APPLIED"),
      finishMatch: vi.fn().mockResolvedValue({}),
      saveRoundAndAnswers: vi.fn().mockResolvedValue({ id: "round-1" }),
    } as unknown as MatchService;

    questionService = {
      getRandom: vi.fn(),
      findOne: vi.fn(),
    } as unknown as QuestionService;

    roomService = {
      updateRoomStatus: vi.fn().mockResolvedValue({}),
    } as unknown as RoomService;

    ownership = {
      assertOwnership: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as MatchOwnershipService;

    disposeCommandStream = vi.fn().mockResolvedValue(undefined);

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    runner = new MatchRoundRunner(
      matchService,
      questionService,
      roomService,
      ownership,
      disposeCommandStream,
    );
  });

  it("COUNTDOWN: arms executeRound at the phaseEndsAt deadline (+2000ms)", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const sm = fakeStateMachine({
      status: MatchStatus.COUNTDOWN,
      phaseEndsAt: now + 2000,
    });
    // The countdown callback re-checks the state machine still exists.
    vi.mocked(matchService.getStateMachine).mockResolvedValue(sm);
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    await vi.advanceTimersByTimeAsync(1999);
    expect(executeRoundSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );
  });

  it("ROUND_ACTIVE: a past phaseEndsAt fires endRound immediately (arms from phaseEndsAt, not endsAt)", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    // phaseEndsAt is in the PAST; currentRound.endsAt is set far in the
    // FUTURE. If resume wrongly armed from endsAt it would wait ~100s;
    // arming from the canonical phaseEndsAt fires at once.
    const sm = fakeStateMachine(
      { status: MatchStatus.ROUND_ACTIVE, phaseEndsAt: now - 1000 },
      [],
      { endsAt: now + 100_000, status: "ACTIVE", question: { id: "q1" } },
    );
    const endRoundSpy = vi
      .spyOn(runner as any, "endRound")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    // remaining clamps to 0 → the timer is due immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(endRoundSpy).toHaveBeenCalledWith("match-1", "room-1", mockServer);
  });

  it("ROUND_RESULT: arms checkMatchEnd after the remaining result-display window", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const sm = fakeStateMachine({
      status: MatchStatus.ROUND_RESULT,
      phaseEndsAt: now + 3000,
    });
    const checkMatchEndSpy = vi
      .spyOn(runner as any, "checkMatchEnd")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    await vi.advanceTimersByTimeAsync(2999);
    expect(checkMatchEndSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(checkMatchEndSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );
  });

  it("ROUND_EVALUATING: invokes endRound immediately via the recovered path (no timer)", async () => {
    const sm = fakeStateMachine({ status: MatchStatus.ROUND_EVALUATING });
    const endRoundSpy = vi
      .spyOn(runner as any, "endRound")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    expect(endRoundSpy).toHaveBeenCalledWith("match-1", "room-1", mockServer);
    // Nothing was armed: the recovered round is finished synchronously.
    expect((runner as any).timers.hasTimers("match-1")).toBe(false);
  });

  it("FINISHED: disposes the runtime and releases the lease, arming nothing", async () => {
    const sm = fakeStateMachine({ status: MatchStatus.FINISHED });
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
      .mockResolvedValue(undefined);
    const endRoundSpy = vi
      .spyOn(runner as any, "endRound")
      .mockResolvedValue(undefined);
    const checkMatchEndSpy = vi
      .spyOn(runner as any, "checkMatchEnd")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    expect(ownership.release).toHaveBeenCalledWith("match-1");
    expect((runner as any).timers.hasTimers("match-1")).toBe(false);
    // B4b: terminal resume drops match:cmd / match:applied consumers + keys.
    expect(disposeCommandStream).toHaveBeenCalledWith("match-1");
    expect(executeRoundSpy).not.toHaveBeenCalled();
    expect(endRoundSpy).not.toHaveBeenCalled();
    expect(checkMatchEndSpy).not.toHaveBeenCalled();
  });

  it("unexpected status (CREATED): disposes command stream without arming timers", async () => {
    // CREATED is a non-timed status → default branch (no phase timer).
    const sm = fakeStateMachine({ status: MatchStatus.CREATED });
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    expect(disposeCommandStream).toHaveBeenCalledWith("match-1");
    expect(ownership.release).toHaveBeenCalledWith("match-1");
    expect(executeRoundSpy).not.toHaveBeenCalled();
    expect((runner as any).timers.hasTimers("match-1")).toBe(false);
    // Used-question set was init'd then cleared via disposeMatch.
    expect((runner as any).timers.hasUsedQuestions("match-1")).toBe(false);
  });

  it("unexpected status: disposeCommandStream rejection still releases ownership via finally", async () => {
    const sm = fakeStateMachine({ status: MatchStatus.CREATED });
    (runner as any).timers.initUsedQuestions("match-1");
    // disposeCommandStream rejects; ownership.release MUST still run.
    disposeCommandStream.mockRejectedValueOnce(new Error("dispose boom"));

    await expect(
      runner.resumeMatchLoop("match-1", sm, "room-1", mockServer),
    ).rejects.toThrow("dispose boom");

    expect(disposeCommandStream).toHaveBeenCalledWith("match-1");
    expect(ownership.release).toHaveBeenCalledWith("match-1");
    // disposeMatch was called before the failing dispose, so used-questions
    // and timers are cleared regardless of the dispose failure.
    expect((runner as any).timers.hasTimers("match-1")).toBe(false);
    expect((runner as any).timers.hasUsedQuestions("match-1")).toBe(false);
  });

  it("F2: rebuilds the used-question set from the ROUND_STARTED event log", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const sm = fakeStateMachine(
      { status: MatchStatus.ROUND_RESULT, phaseEndsAt: now + 3000 },
      [
        { type: "ROUND_STARTED", payload: { questionId: "q1" } },
        { type: "ROUND_EVALUATED", payload: { roundNo: 1 } },
        { type: "ROUND_STARTED", payload: { questionId: "q2" } },
      ],
    );

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    const used = (runner as any).timers.getUsedQuestions("match-1");
    expect(used).toBeDefined();
    expect(used).toContain("q1");
    expect(used).toContain("q2");
    expect(used.size).toBe(2);

    // Drop the armed timer so it does not leak into later suites.
    runner.cancelMatchLoop("match-1");
  });

  it("exactly-once: resuming ROUND_ACTIVE then letting the round end saves exactly once", async () => {
    vi.useFakeTimers();

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
    const sm = new MatchStateMachine("match-1", "room-1", players);
    sm.transition(MatchStatus.COUNTDOWN);
    sm.transition(MatchStatus.ROUND_ACTIVE);
    sm.startRound({
      id: "q1",
      content: "Test question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });
    sm.submitAnswer("p1", "A", Date.now());
    sm.submitAnswer("p2", "B", Date.now());

    // endRound (fired by the armed timer) re-reads the state machine.
    vi.mocked(matchService.getStateMachine).mockResolvedValue(sm);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    // startRound set phaseEndsAt = now + ROUND_DURATION_MS, so the timer is
    // armed for the full remaining window.
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);

    expect(matchService.saveRoundAndAnswers).toHaveBeenCalledTimes(1);
    expect(sm.getState().status).toBe(MatchStatus.ROUND_RESULT);
  });

  it("ROUND_ACTIVE: restores the expected-answer count for early termination", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const sm = fakeStateMachine({
      status: MatchStatus.ROUND_ACTIVE,
      phaseEndsAt: now + GAME_CONFIG.ROUND_DURATION_MS,
      survivingPlayerIds: ["p1", "p2", "p3"],
    });
    vi.spyOn(runner as any, "endRound").mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    expect((runner as any).timers.getExpectedAnswers("match-1")).toBe(3);
    runner.cancelMatchLoop("match-1");
  });

  it("fail-closed: a resumed COUNTDOWN missing phaseEndsAt rebuilds the deadline from startedAt (no fresh full window)", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    // startedAt is 4s ago and phaseEndsAt is absent (should be impossible
    // post-B1b/B1c). The deadline is reconstructed as startedAt + 5000, so
    // only ~1s remains — NOT a fresh 5s window.
    const sm = fakeStateMachine({
      status: MatchStatus.COUNTDOWN,
      phaseEndsAt: null,
      startedAt: now - 4000,
    });
    vi.mocked(matchService.getStateMachine).mockResolvedValue(sm);
    const executeRoundSpy = vi
      .spyOn(runner as any, "executeRound")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    await vi.advanceTimersByTimeAsync(999);
    expect(executeRoundSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(executeRoundSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );
  });

  it("fail-closed: a resumed timed phase with no phaseEndsAt and no anchor fires immediately", async () => {
    vi.useFakeTimers();
    // No phaseEndsAt and no roundResultStartedAt anchor → remaining = 0.
    const sm = fakeStateMachine({
      status: MatchStatus.ROUND_RESULT,
      phaseEndsAt: null,
      roundResultStartedAt: null,
    });
    const checkMatchEndSpy = vi
      .spyOn(runner as any, "checkMatchEnd")
      .mockResolvedValue(undefined);

    await runner.resumeMatchLoop("match-1", sm, "room-1", mockServer);

    await vi.advanceTimersByTimeAsync(0);
    expect(checkMatchEndSpy).toHaveBeenCalledWith(
      "match-1",
      "room-1",
      mockServer,
    );
  });
});
