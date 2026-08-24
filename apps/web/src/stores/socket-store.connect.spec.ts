import {
  ClientEvent,
  ErrorCode,
  ServerEvent,
  PlayerStatus,
  MatchStatus,
  type CardEffectEvent,
  type SnapshotPayload,
  type VoteBanTopicPayload,
} from "@arena/shared";
import { INITIAL_CARD_STATE } from "./socket-store.types";
import { hasSecondChancePermission } from "./socket-store.helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSocketStateMaps } from "./socket-store.state-maps";

const waitForSocketAckMock = vi.hoisted(() => vi.fn());

vi.mock("./socket-store.helpers", async () => {
  const actual = await vi.importActual<typeof import("./socket-store.helpers")>(
    "./socket-store.helpers",
  );
  return {
    ...actual,
    waitForSocketAck: waitForSocketAckMock,
    waitForAuthAck: (socket: unknown) =>
      waitForSocketAckMock({
        socket,
        successEvent: ServerEvent.AUTHENTICATED,
      }),
  };
});

let useSocketStore: typeof import("./socket-store").useSocketStore;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildMockSnapshot(
  overrides: Partial<{
    matchId: string;
    status: MatchStatus;
    currentRoundNo: number;
    players: Array<{
      id: string;
      name: string;
      status: PlayerStatus;
      score: number;
    }>;
    currentQuestion: {
      id: string;
      content: string;
      options: string[];
    } | null;
    roundEndTime: number | null;
    lastEventSeqNo: number;
  }> = {},
): SnapshotPayload {
  return {
    matchId: "m1",
    status: MatchStatus.ROUND_ACTIVE,
    currentRoundNo: 1,
    players: [
      { id: "p1", name: "Player 1", status: PlayerStatus.ACTIVE, score: 10 },
    ],
    currentQuestion: {
      id: "q1",
      content: "What is 1+1?",
      options: ["1", "2", "3"],
    },
    roundEndTime: 123456789,
    lastEventSeqNo: 42,
    ...overrides,
  };
}

type TriggerableSocket = {
  trigger?: (event: string, data?: unknown) => void;
  listeners?: (event: string) => Array<(...args: unknown[]) => void>;
};

function triggerSocketEvent(
  socket: TriggerableSocket | null | undefined,
  event: string,
  data?: unknown,
) {
  if (!socket) return;
  if (typeof socket.trigger === "function") {
    socket.trigger(event, data);
    return;
  }
  socket.listeners?.(event).forEach((listener) => listener(data));
}

function createMockSocket() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    connected: true,
    emit: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(callback);
    }),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((cb) => cb !== callback);
      }
    }),
    trigger: (event: string, data?: unknown) => {
      if (listeners[event]) {
        listeners[event].forEach((cb) => cb(data));
      }
    },
  };
}

describe("socket-store connect heartbeat ownership", () => {
  beforeEach(async () => {
    resetSocketStateMaps();
    vi.resetModules();
    ({ useSocketStore } = await import("./socket-store"));
    vi.clearAllMocks();
    useSocketStore.setState({
      socket: null,
      isConnected: false,
      isAuthenticated: false,
      userId: null,
      username: null,
      accessToken: "token",
      userRole: null,
      room: null,
      match: null,
      lastAnswerResult: null,
      pendingAnswer: null,
      remainingCount: null,
      error: null,
      heartbeatInterval: null,
      isEliminated: false,
      roomTerminated: false,
      roomTerminationMessage: null,
      lastSeenSeqNo: 0,
    });
  });

  it("coalesces concurrent connect attempts and returns the same in-flight promise", async () => {
    const auth = deferred<void>();
    waitForSocketAckMock.mockReturnValueOnce(auth.promise);

    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      const firstConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket = useSocketStore.getState().socket;

      const secondConnect = useSocketStore.getState().connect();
      expect(secondConnect).toBe(firstConnect);
      expect(useSocketStore.getState().socket).toBe(socket);

      auth.resolve();
      await firstConnect;
      await secondConnect;

      expect(useSocketStore.getState().socket).toBe(socket);
    } finally {
      useSocketStore.getState().disconnect();
    }
  });

  it("clears stored promise in finally after auth failure so subsequent connect can retry", async () => {
    waitForSocketAckMock.mockRejectedValueOnce(
      new Error("Authentication failed"),
    );

    await expect(useSocketStore.getState().connect()).rejects.toThrow(
      "Authentication failed",
    );

    // Second connect should initiate a new connection attempt
    const secondAuth = deferred<void>();
    waitForSocketAckMock.mockReturnValueOnce(secondAuth.promise);

    let socket2: ReturnType<typeof useSocketStore.getState>["socket"] = null;
    try {
      const secondConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket2 = useSocketStore.getState().socket;

      secondAuth.resolve();
      await secondConnect;

      expect(useSocketStore.getState().socket).toBe(socket2);
    } finally {
      useSocketStore.getState().disconnect();
    }
  });

  it("handles connect() -> disconnect() -> connect() before the original ACK arrives without stale attempt interference", async () => {
    const auth1 = deferred<void>();
    const auth2 = deferred<void>();
    waitForSocketAckMock
      .mockReturnValueOnce(auth1.promise)
      .mockReturnValueOnce(auth2.promise);

    let socket1: ReturnType<typeof useSocketStore.getState>["socket"] = null;
    let socket2: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      const firstConnectPromise = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket1 = useSocketStore.getState().socket;

      // Disconnect before auth1 resolves
      useSocketStore.getState().disconnect();
      expect(useSocketStore.getState().socket).toBeNull();
      expect(useSocketStore.getState().isConnected).toBe(false);

      // Supply token and start new connect() before original ACK arrives
      useSocketStore.setState({ accessToken: "token-2" });
      const secondConnectPromise = useSocketStore.getState().connect();
      expect(secondConnectPromise).not.toBe(firstConnectPromise);

      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket2 = useSocketStore.getState().socket;
      expect(socket2).not.toBe(socket1);

      // Stale ACK arrives for the first connect attempt
      auth1.resolve();
      await firstConnectPromise;

      // Ensure second connect is still the active in-flight connection and socket is socket2
      expect(useSocketStore.getState().socket).toBe(socket2);

      // Second connect ACK arrives
      auth2.resolve();
      await secondConnectPromise;

      expect(useSocketStore.getState().socket).toBe(socket2);
      expect(useSocketStore.getState().heartbeatInterval).not.toBeNull();
    } finally {
      socket1?.disconnect();
      useSocketStore.getState().disconnect();
    }
  });

  it("fast-paths connect() when socket is already connected and authenticated", async () => {
    const mockSocket = createMockSocket();
    mockSocket.connected = true;
    useSocketStore.setState({
      socket: mockSocket as unknown as ReturnType<
        typeof useSocketStore.getState
      >["socket"],
      isConnected: true,
      isAuthenticated: true,
    });

    await useSocketStore.getState().connect();

    expect(useSocketStore.getState().socket).toBe(mockSocket);
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("clears pending answer on current-socket disconnect", async () => {
    waitForSocketAckMock.mockResolvedValueOnce(undefined);
    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      await useSocketStore.getState().connect();
      socket = useSocketStore.getState().socket;
      useSocketStore.setState({
        pendingAnswer: {
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
        },
      });

      socket?.listeners("disconnect").forEach((listener) => {
        listener("transport close");
      });

      expect(useSocketStore.getState().pendingAnswer).toBeNull();
      expect(useSocketStore.getState().isConnected).toBe(false);
      expect(useSocketStore.getState().isAuthenticated).toBe(false);
    } finally {
      socket?.disconnect();
    }
  });

  it("keeps pending answer for uncorrelated current-socket errors", async () => {
    waitForSocketAckMock.mockResolvedValueOnce(undefined);
    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      await useSocketStore.getState().connect();
      socket = useSocketStore.getState().socket;
      useSocketStore.setState({
        pendingAnswer: {
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
        },
      });

      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "uncorrelated",
        });
      });

      expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe("s1");
    } finally {
      socket?.disconnect();
    }
  });

  it("clears pending answer for submit-answer correlated errors", async () => {
    waitForSocketAckMock.mockResolvedValueOnce(undefined);
    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      await useSocketStore.getState().connect();
      socket = useSocketStore.getState().socket;
      useSocketStore.setState({
        pendingAnswer: {
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
        },
      });

      // Assert pendingAnswer stays unchanged when the error does not carry a matching submissionId
      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "submit failed",
          failedEvent: ClientEvent.SUBMIT_ANSWER,
        });
      });

      expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe("s1");

      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "submit failed",
          submissionId: "s1",
        });
      });

      expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe("s1");

      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "submit failed",
          failedEvent: ClientEvent.SUBMIT_ANSWER,
          submissionId: "s1",
        });
      });

      await vi.waitFor(() =>
        expect(useSocketStore.getState().pendingAnswer).toBeNull(),
      );
    } finally {
      socket?.disconnect();
    }
  });

  it("clears pending answer on matching submissionId, but leaves it intact on mismatched submissionId", async () => {
    waitForSocketAckMock.mockResolvedValueOnce(undefined);
    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      await useSocketStore.getState().connect();
      socket = useSocketStore.getState().socket;

      // 1. Mismatched submissionId
      useSocketStore.setState({
        pendingAnswer: {
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "current-submission-id",
        },
      });

      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "stale submission error",
          submissionId: "stale-submission-id",
        });
      });

      expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe(
        "current-submission-id",
      );

      socket?.listeners(ServerEvent.ERROR).forEach((listener) => {
        listener({
          code: ErrorCode.INTERNAL_ERROR,
          message: "matching submission error",
          failedEvent: ClientEvent.SUBMIT_ANSWER,
          submissionId: "current-submission-id",
        });
      });

      await vi.waitFor(() =>
        expect(useSocketStore.getState().pendingAnswer).toBeNull(),
      );
    } finally {
      socket?.disconnect();
    }
  });

  it("does not create pending answer state while disconnected", () => {
    const submissionId = useSocketStore.getState().submitAnswer("m1", 1, "A");

    expect(submissionId).toBeNull();
    expect(useSocketStore.getState().pendingAnswer).toBeNull();
  });

  it("creates pending answer state only when submit can emit", () => {
    const emit = vi.fn();
    useSocketStore.setState({
      socket: {
        connected: true,
        emit,
      } as unknown as ReturnType<typeof useSocketStore.getState>["socket"],
    });

    const submissionId = useSocketStore.getState().submitAnswer("m1", 1, "A");

    expect(submissionId).toBeTruthy();
    expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe(
      submissionId,
    );
    expect(emit).toHaveBeenCalledWith(
      ClientEvent.SUBMIT_ANSWER,
      expect.objectContaining({ submissionId }),
    );
  });

  it("rejects duplicate submission and does not emit when SECOND_CHANCE targetRoundNo does not match submission round", () => {
    const emit = vi.fn();
    const scEffect: CardEffectEvent = {
      matchId: "m1",
      roundNo: 1,
      targetRoundNo: 2,
      cardId: "TN-6",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p1"],
      effect: { kind: "SECOND_CHANCE" },
      resolution: "MUTATION",
      serverTimestamp: 1000,
      expiresAtServer: null,
      remainingMs: null,
    };
    useSocketStore.setState({
      userId: "p1",
      socket: {
        connected: true,
        emit,
      } as unknown as ReturnType<typeof useSocketStore.getState>["socket"],
      lastAnswerResult: {
        matchId: "m1",
        roundNo: 1,
        submissionId: "s1",
        isCorrect: false,
        responseTimeMs: 1000,
      },
      pendingAnswer: null,
      cardState: {
        ...INITIAL_CARD_STATE,
        activeRoundEffects: [scEffect],
        lastResolvedEffect: scEffect,
      },
    });

    const submissionId = useSocketStore.getState().submitAnswer("m1", 1, "B");
    expect(submissionId).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(useSocketStore.getState().pendingAnswer).toBeNull();
  });

  it("allows retry submission when local user is in targetPlayerIds of SECOND_CHANCE effect", () => {
    const emit = vi.fn();
    const scEffect: CardEffectEvent = {
      matchId: "m1",
      roundNo: 1,
      targetRoundNo: 1,
      cardId: "TN-6",
      offerSeqNo: 1,
      playedByPlayerId: "other-player",
      targetPlayerIds: ["p1"],
      effect: { kind: "SECOND_CHANCE" },
      resolution: "MUTATION",
      serverTimestamp: 1000,
      expiresAtServer: null,
      remainingMs: null,
    };
    useSocketStore.setState({
      userId: "p1",
      socket: {
        connected: true,
        emit,
      } as unknown as ReturnType<typeof useSocketStore.getState>["socket"],
      lastAnswerResult: {
        matchId: "m1",
        roundNo: 1,
        submissionId: "s1",
        isCorrect: false,
        responseTimeMs: 1000,
      },
      cardState: {
        ...INITIAL_CARD_STATE,
        activeRoundEffects: [scEffect],
      },
    });

    const submissionId = useSocketStore.getState().submitAnswer("m1", 1, "C");
    expect(submissionId).toBeDefined();
    expect(emit).toHaveBeenCalledWith(
      ClientEvent.SUBMIT_ANSWER,
      expect.objectContaining({
        matchId: "m1",
        roundNo: 1,
        answer: "C",
      }),
    );
  });

  describe("hasSecondChancePermission", () => {
    const baseEffect: CardEffectEvent = {
      matchId: "m1",
      roundNo: 2,
      targetRoundNo: 2,
      cardId: "TN-6",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p1"],
      effect: { kind: "SECOND_CHANCE" },
      resolution: "MUTATION",
      serverTimestamp: 1000,
      expiresAtServer: null,
      remainingMs: null,
    };

    it("returns true when userId matches playedByPlayerId in activeRoundEffects", () => {
      const cardState = {
        activeRoundEffects: [
          { ...baseEffect, playedByPlayerId: "user-1", targetPlayerIds: [] },
        ],
        lastResolvedEffect: null,
      };
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(true);
    });

    it("returns true when userId matches targetPlayerIds in activeRoundEffects", () => {
      const cardState = {
        activeRoundEffects: [
          {
            ...baseEffect,
            playedByPlayerId: "other",
            targetPlayerIds: ["user-1"],
          },
        ],
        lastResolvedEffect: null,
      };
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(true);
    });

    it("returns true when effect is in lastResolvedEffect for current round", () => {
      const cardState = {
        activeRoundEffects: [],
        lastResolvedEffect: { ...baseEffect, playedByPlayerId: "user-1" },
      };
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(true);
    });

    it("falls back to roundNo when targetRoundNo is absent", () => {
      const effectWithoutTargetRound: CardEffectEvent = {
        ...baseEffect,
        targetRoundNo: undefined,
        roundNo: 3,
        playedByPlayerId: "user-1",
      };
      const cardState = {
        activeRoundEffects: [effectWithoutTargetRound],
        lastResolvedEffect: null,
      };
      expect(hasSecondChancePermission(cardState, "user-1", 3)).toBe(true);
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(false);
    });

    it("returns false when round does not match", () => {
      const cardState = {
        activeRoundEffects: [
          { ...baseEffect, targetRoundNo: 3, playedByPlayerId: "user-1" },
        ],
        lastResolvedEffect: null,
      };
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(false);
    });

    it("returns false when user is not card player and not in targets", () => {
      const cardState = {
        activeRoundEffects: [
          {
            ...baseEffect,
            playedByPlayerId: "user-2",
            targetPlayerIds: ["user-3"],
          },
        ],
        lastResolvedEffect: null,
      };
      expect(hasSecondChancePermission(cardState, "user-1", 2)).toBe(false);
    });

    it("returns false for null/undefined inputs", () => {
      expect(hasSecondChancePermission(null, "user-1", 2)).toBe(false);
      expect(hasSecondChancePermission(undefined, "user-1", 2)).toBe(false);
      expect(
        hasSecondChancePermission(
          { activeRoundEffects: [baseEffect], lastResolvedEffect: null },
          null,
          2,
        ),
      ).toBe(false);
    });
  });

  it("optimistically hydrates SNAPSHOT UI while preserving lastSeenSeqNo for pending delta", async () => {
    waitForSocketAckMock.mockResolvedValueOnce(undefined);
    let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;
    let emitSpy: { mockRestore: () => void } | null = null;

    try {
      await useSocketStore.getState().connect();
      socket = useSocketStore.getState().socket;
      // Unit tests have no live server; force connected so emitIfConnected runs.
      Object.defineProperty(socket, "connected", {
        configurable: true,
        get: () => true,
      });
      const emit = vi.spyOn(
        socket as unknown as { emit: (...args: unknown[]) => unknown },
        "emit",
      );
      emitSpy = emit;

      useSocketStore.setState({
        match: {
          id: "m1",
          status: MatchStatus.COUNTDOWN,
          currentRoundNo: 0,
          players: [],
          currentQuestion: null,
          roundEndTime: null,
        },
        lastSeenSeqNo: 12,
      });

      // Arm pendingSnapshotRequest the same way AUTHENTICATED does.
      // Real connect() sockets use listeners(); triggerSocketEvent unifies
      // that path with mockSocket.trigger used in the fallback suite.
      triggerSocketEvent(socket, ServerEvent.AUTHENTICATED, {
        userId: "u1",
        username: "Alice",
        role: "PLAYER",
      });

      const serverSnapshot = buildMockSnapshot({
        currentRoundNo: 3,
        currentQuestion: {
          id: "q3",
          content: "What is 2+2?",
          options: ["3", "4", "5"],
        },
        roundEndTime: 999,
        lastEventSeqNo: 99,
      });

      triggerSocketEvent(socket, ServerEvent.SNAPSHOT, serverSnapshot);

      const state = useSocketStore.getState();
      expect(state.match?.currentRoundNo).toBe(3);
      expect(state.match?.currentQuestion?.id).toBe("q3");
      // Cursor must stay pre-disconnect so REQUEST_SNAPSHOT can delta.
      expect(state.lastSeenSeqNo).toBe(12);
      expect(emit).toHaveBeenCalledWith(ClientEvent.REQUEST_SNAPSHOT, {
        matchId: "m1",
        lastSeenSeqNo: 12,
      });
    } finally {
      emitSpy?.mockRestore();
      // Avoid disconnect() after overriding `connected` (socket.io getter only).
      socket?.removeAllListeners();
    }
  });

  describe("requestSnapshot fallback logic", () => {
    let mockSocket: ReturnType<typeof createMockSocket>;
    const mockFallbackSnapshot = buildMockSnapshot();

    beforeEach(() => {
      mockSocket = createMockSocket();

      useSocketStore.setState({
        socket: mockSocket as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
        lastSeenSeqNo: 0,
        match: {
          id: "m1",
          status: MatchStatus.COUNTDOWN,
          currentRoundNo: 0,
          players: [],
          currentQuestion: null,
          roundEndTime: null,
        },
      });
    });

    it("does not apply fallback if EVENT_BATCH is received for matching matchId", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      triggerSocketEvent(mockSocket, ServerEvent.EVENT_BATCH, {
        matchId: "m1",
        events: [],
      });

      // Match state should NOT be fallback snapshot
      expect(useSocketStore.getState().match?.currentRoundNo).toBe(0);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(0);
    });

    it("does not apply fallback if SNAPSHOT is received for matching matchId", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      triggerSocketEvent(mockSocket, ServerEvent.SNAPSHOT, { matchId: "m1" });

      // Match state should NOT be fallback snapshot
      expect(useSocketStore.getState().match?.currentRoundNo).toBe(0);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(0);
    });

    it("applies fallback snapshot on REQUEST_SNAPSHOT error", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      triggerSocketEvent(mockSocket, ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "fail",
        failedEvent: ClientEvent.REQUEST_SNAPSHOT,
      });

      expect(useSocketStore.getState().match?.currentRoundNo).toBe(1);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(42);
    });

    it("does not apply fallback on unrelated ERROR", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      triggerSocketEvent(mockSocket, ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "answer failed",
        failedEvent: ClientEvent.SUBMIT_ANSWER,
      });

      expect(useSocketStore.getState().match?.currentRoundNo).toBe(0);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(0);
    });

    it("applies fallback snapshot on socket disconnect", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      triggerSocketEvent(mockSocket, "disconnect");

      // Match state should now be fallback snapshot
      expect(useSocketStore.getState().match?.currentRoundNo).toBe(1);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(42);
    });

    it("does not apply fallback when disconnect is from a stale socket", () => {
      useSocketStore.getState().requestSnapshot("m1", 0, mockFallbackSnapshot);

      // Simulate reconnect churn: store now points at a newer socket.
      useSocketStore.setState({
        socket: {
          connected: true,
          emit: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
        } as unknown as ReturnType<typeof useSocketStore.getState>["socket"],
      });

      triggerSocketEvent(mockSocket, "disconnect");

      expect(useSocketStore.getState().match?.currentRoundNo).toBe(0);
      expect(useSocketStore.getState().lastSeenSeqNo).toBe(0);
    });

    it("applies fallback snapshot on timeout", () => {
      vi.useFakeTimers();
      try {
        useSocketStore
          .getState()
          .requestSnapshot("m1", 0, mockFallbackSnapshot);

        vi.advanceTimersByTime(4999);
        expect(useSocketStore.getState().match?.currentRoundNo).toBe(0);
        expect(useSocketStore.getState().lastSeenSeqNo).toBe(0);

        vi.advanceTimersByTime(1);

        // Match state should now be fallback snapshot
        expect(useSocketStore.getState().match?.currentRoundNo).toBe(1);
        expect(useSocketStore.getState().lastSeenSeqNo).toBe(42);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("voteBanTopic rollback handling", () => {
    async function setupConnectedSocket() {
      await useSocketStore.getState().connect();
      const socket = useSocketStore.getState().socket;
      expect(socket).not.toBeNull();
      if (!socket) {
        throw new Error("Socket is not initialized");
      }
      let isConnected = true;
      Object.defineProperty(socket, "connected", {
        configurable: true,
        get: () => isConnected,
        set: (v) => {
          isConnected = v;
        },
      });
      const emitSpy = vi.spyOn(
        socket as unknown as { emit: (...args: unknown[]) => unknown },
        "emit",
      );
      return { socket, emitSpy };
    }

    function extractVoteCommandId(
      emitSpy: { mock: { calls: unknown[][] } },
      topic: string,
    ): string {
      const voteCall = emitSpy.mock.calls.find(
        (c) =>
          c[0] === ClientEvent.VOTE_BAN_TOPIC &&
          (c[1] as VoteBanTopicPayload | undefined)?.topic === topic,
      );
      expect(voteCall).toBeDefined();
      const commandId = (voteCall![1] as VoteBanTopicPayload).commandId;
      expect(typeof commandId).toBe("string");
      return commandId!;
    }

    it("rolls back two consecutive votes correctly when both receive matching error payloads", async () => {
      waitForSocketAckMock.mockResolvedValueOnce(undefined);
      let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

      try {
        const setup = await setupConnectedSocket();
        socket = setup.socket;
        const { emitSpy } = setup;

        useSocketStore.setState({
          topicVoting: {
            matchId: "m1",
            candidateTopics: ["SCIENCE", "HISTORY"],
            endsAt: Date.now() + 10_000,
            durationMs: 10_000,
            voteCounts: { SCIENCE: 0, HISTORY: 0 },
            myVotedTopic: null,
            totalVotes: 0,
            bannedTopics: [],
            activeTopics: [],
            isFinished: false,
          },
        });

        // Vote 1: cast vote for SCIENCE
        useSocketStore.getState().voteBanTopic("m1", "SCIENCE");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );
        const commandId1 = extractVoteCommandId(emitSpy, "SCIENCE");

        // Vote 2: cast subsequent vote for HISTORY
        useSocketStore.getState().voteBanTopic("m1", "HISTORY");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );
        const commandId2 = extractVoteCommandId(emitSpy, "HISTORY");
        expect(commandId2).not.toBe(commandId1);

        // Error for Vote 2 arrives first
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Vote 2 failed",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: commandId2,
        });

        // Should restore Vote 2's previous topic (SCIENCE)
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );

        // Error for Vote 1 arrives
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Vote 1 failed",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: commandId1,
        });

        // Should restore Vote 1's previous topic (null)
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBeNull();
      } finally {
        socket?.removeAllListeners();
        socket?.disconnect();
      }
    });

    it("rolls back two consecutive votes correctly when error for commandId1 arrives before commandId2", async () => {
      waitForSocketAckMock.mockResolvedValueOnce(undefined);
      let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

      try {
        const setup = await setupConnectedSocket();
        socket = setup.socket;
        const { emitSpy } = setup;

        useSocketStore.setState({
          topicVoting: {
            matchId: "m1",
            candidateTopics: ["SCIENCE", "HISTORY"],
            endsAt: Date.now() + 10_000,
            durationMs: 10_000,
            voteCounts: { SCIENCE: 0, HISTORY: 0 },
            myVotedTopic: null,
            totalVotes: 0,
            bannedTopics: [],
            activeTopics: [],
            isFinished: false,
          },
        });

        // Vote 1: cast vote for SCIENCE
        useSocketStore.getState().voteBanTopic("m1", "SCIENCE");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );
        const commandId1 = extractVoteCommandId(emitSpy, "SCIENCE");

        // Vote 2: cast subsequent vote for HISTORY
        useSocketStore.getState().voteBanTopic("m1", "HISTORY");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );
        const commandId2 = extractVoteCommandId(emitSpy, "HISTORY");
        expect(commandId2).not.toBe(commandId1);

        // Error for Vote 1 arrives first
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Vote 1 failed",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: commandId1,
        });

        // Assert myVotedTopic remains HISTORY after the first rollback
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );

        // Error for Vote 2 arrives second
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Vote 2 failed",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: commandId2,
        });

        // Assert myVotedTopic becomes null after the second rollback
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBeNull();
      } finally {
        socket?.removeAllListeners();
        socket?.disconnect();
      }
    });

    it("does not roll back when error commandId is mismatched or missing", async () => {
      waitForSocketAckMock.mockResolvedValueOnce(undefined);
      let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

      try {
        const setup = await setupConnectedSocket();
        socket = setup.socket;

        useSocketStore.setState({
          topicVoting: {
            matchId: "m1",
            candidateTopics: ["SCIENCE", "HISTORY"],
            endsAt: Date.now() + 10_000,
            durationMs: 10_000,
            voteCounts: { SCIENCE: 0, HISTORY: 0 },
            myVotedTopic: null,
            totalVotes: 0,
            bannedTopics: [],
            activeTopics: [],
            isFinished: false,
          },
        });

        useSocketStore.getState().voteBanTopic("m1", "SCIENCE");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );

        // Error without commandId
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "unrelated error",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
        });
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );

        // Error with mismatched commandId
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "mismatched commandId",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: "wrong-command-id",
        });
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "SCIENCE",
        );
      } finally {
        socket?.removeAllListeners();
        socket?.disconnect();
      }
    });

    it("clears pending vote state on TOPIC_VOTING_STARTED and TOPIC_VOTING_FINISHED", async () => {
      waitForSocketAckMock.mockResolvedValue(undefined);
      let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

      try {
        const setup = await setupConnectedSocket();
        socket = setup.socket;
        const { emitSpy } = setup;

        // 1. TOPIC_VOTING_STARTED scenario: new phase resets pending vote state
        useSocketStore.setState({
          topicVoting: {
            matchId: "m1",
            candidateTopics: ["SCIENCE", "HISTORY"],
            endsAt: Date.now() + 10_000,
            durationMs: 10_000,
            voteCounts: { SCIENCE: 0, HISTORY: 0 },
            myVotedTopic: null,
            totalVotes: 0,
            bannedTopics: [],
            activeTopics: [],
            isFinished: false,
          },
        });

        // Cast vote
        useSocketStore.getState().voteBanTopic("m1", "SCIENCE");
        const commandId = extractVoteCommandId(emitSpy, "SCIENCE");

        // TOPIC_VOTING_STARTED for new phase resets pending vote state
        triggerSocketEvent(socket, ServerEvent.TOPIC_VOTING_STARTED, {
          matchId: "m1",
          candidateTopics: ["TECH", "SPORTS"],
          endsAt: Date.now() + 15_000,
          durationMs: 15_000,
        });

        // A late arriving error from previous phase should not roll back the new phase
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "stale vote failed",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId,
        });
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBeNull();

        // 2. TOPIC_VOTING_FINISHED scenario: phase is marked finished, final myVotedTopic is retained, and only stale errors are ignored
        emitSpy.mockClear();
        useSocketStore.setState({
          topicVoting: {
            matchId: "m2",
            candidateTopics: ["SCIENCE", "HISTORY"],
            endsAt: Date.now() + 10_000,
            durationMs: 10_000,
            voteCounts: { SCIENCE: 0, HISTORY: 0 },
            myVotedTopic: null,
            totalVotes: 0,
            bannedTopics: [],
            activeTopics: [],
            isFinished: false,
          },
        });

        // Cast vote
        useSocketStore.getState().voteBanTopic("m2", "HISTORY");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );
        const commandIdFinished = extractVoteCommandId(emitSpy, "HISTORY");

        // TOPIC_VOTING_FINISHED marks the phase as finished and retains voted topic
        triggerSocketEvent(socket, ServerEvent.TOPIC_VOTING_FINISHED, {
          matchId: "m2",
          bannedTopics: ["HISTORY"],
          activeTopics: ["SCIENCE"],
          voteCounts: { SCIENCE: 0, HISTORY: 1 },
        });
        expect(useSocketStore.getState().topicVoting?.isFinished).toBe(true);
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );

        // Stale ERROR with commandId from finished phase must not roll back topicVoting
        triggerSocketEvent(socket, ServerEvent.ERROR, {
          code: ErrorCode.INTERNAL_ERROR,
          message: "stale error after voting finished",
          failedEvent: ClientEvent.VOTE_BAN_TOPIC,
          commandId: commandIdFinished,
        });
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );
        expect(useSocketStore.getState().topicVoting?.isFinished).toBe(true);
        expect(useSocketStore.getState().topicVoting?.bannedTopics).toEqual([
          "HISTORY",
        ]);
      } finally {
        socket?.removeAllListeners();
        socket?.disconnect();
      }
    });
  });

  describe("matchmaking actions", () => {
    it("joinMatchmaking emits JOIN_MATCHMAKING and does not set queue state optimistically", () => {
      const mockSocket = createMockSocket();
      useSocketStore.setState({
        socket: mockSocket as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
        matchmaking: {
          isQueued: false,
          queuedAt: null,
          elapsedSeconds: 0,
          estimatedWaitSeconds: 0,
          playersInQueue: 0,
          matchedRoomCode: null,
          matchedRoomId: null,
          matchedMatchId: null,
        },
      });

      useSocketStore.getState().joinMatchmaking("SCIENCE");

      expect(mockSocket.emit).toHaveBeenCalledWith(
        ClientEvent.JOIN_MATCHMAKING,
        { category: "SCIENCE" },
      );

      // Verify state was NOT updated optimistically
      const state = useSocketStore.getState();
      expect(state.matchmaking.isQueued).toBe(false);
      expect(state.matchmaking.queuedAt).toBeNull();
      expect(state.matchmaking.playersInQueue).toBe(0);
    });
  });

  describe("updateAuth", () => {
    it("resets isAuthenticated to false before emitting AUTHENTICATE when starting with isAuthenticated true", async () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      useSocketStore.setState({
        socket: mockSocket as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
        isConnected: true,
        isAuthenticated: true,
      });

      const ackDeferred = deferred<void>();
      waitForSocketAckMock.mockReturnValueOnce(ackDeferred.promise);

      const updateAuthPromise = useSocketStore.getState().updateAuth({
        accessToken: "admin-jwt-token",
        userId: "admin-id-1",
        username: "admin_user",
        userRole: "ADMIN",
      });

      // Verify payload fields updated in store and isAuthenticated reset to false
      const stateBeforeAck = useSocketStore.getState();
      expect(stateBeforeAck.accessToken).toBe("admin-jwt-token");
      expect(stateBeforeAck.userId).toBe("admin-id-1");
      expect(stateBeforeAck.username).toBe("admin_user");
      expect(stateBeforeAck.userRole).toBe("ADMIN");
      expect(stateBeforeAck.isAuthenticated).toBe(false);

      // Verify AUTHENTICATE event was emitted
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvent.AUTHENTICATE, {
        token: "admin-jwt-token",
      });
      expect(waitForSocketAckMock).toHaveBeenCalledWith(
        expect.objectContaining({
          socket: mockSocket,
          successEvent: ServerEvent.AUTHENTICATED,
        }),
      );

      // Resolve server ack
      ackDeferred.resolve();
      await updateAuthPromise;

      // isAuthenticated must now be true
      expect(useSocketStore.getState().isAuthenticated).toBe(true);
    });

    it("when socket is connected and authentication ACK times out or is rejected, disconnects socket, rejects to caller, and keeps isAuthenticated false", async () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      const disconnectSpy = vi.fn();
      mockSocket.disconnect = disconnectSpy;

      useSocketStore.setState({
        socket: mockSocket as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
        isConnected: true,
        isAuthenticated: true,
      });

      waitForSocketAckMock.mockRejectedValueOnce(
        new Error("Authentication timed out"),
      );

      await expect(
        useSocketStore.getState().updateAuth({
          accessToken: "bad-token",
          userId: "u-bad",
          username: "bad_user",
          userRole: "GUEST",
        }),
      ).rejects.toThrow("Authentication timed out");

      expect(disconnectSpy).toHaveBeenCalled();
      expect(useSocketStore.getState().isAuthenticated).toBe(false);
    });

    it("does not set isAuthenticated to true if active socket changed before ACK resolved", async () => {
      const socket1 = createMockSocket();
      socket1.connected = true;
      const socket2 = createMockSocket();
      socket2.connected = true;

      useSocketStore.setState({
        socket: socket1 as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
        isConnected: true,
        isAuthenticated: false,
      });

      const ackDeferred = deferred<void>();
      waitForSocketAckMock.mockReturnValueOnce(ackDeferred.promise);

      const updateAuthPromise = useSocketStore.getState().updateAuth({
        accessToken: "jwt-token",
        userId: "u1",
        username: "user1",
        userRole: "GUEST",
      });

      // Socket changed to socket2 before ACK resolved
      useSocketStore.setState({
        socket: socket2 as unknown as ReturnType<
          typeof useSocketStore.getState
        >["socket"],
      });

      ackDeferred.resolve();
      await updateAuthPromise;

      // Because socket changed, isAuthenticated should remain false
      expect(useSocketStore.getState().isAuthenticated).toBe(false);
    });

    it("when socket is not connected, calls connect() and preserves user/token info", async () => {
      useSocketStore.setState({
        socket: null,
        isConnected: false,
        isAuthenticated: false,
      });

      const connectSpy = vi
        .spyOn(useSocketStore.getState(), "connect")
        .mockResolvedValueOnce();

      await useSocketStore.getState().updateAuth({
        accessToken: "fresh-token",
        userId: "u-fresh",
        username: "fresh_user",
        userRole: "ADMIN",
      });

      expect(connectSpy).toHaveBeenCalled();
      const state = useSocketStore.getState();
      expect(state.accessToken).toBe("fresh-token");
      expect(state.userId).toBe("u-fresh");
      expect(state.username).toBe("fresh_user");
      expect(state.userRole).toBe("ADMIN");
    });

    it("when socket is not connected and connect() fails, error is propagated to caller", async () => {
      useSocketStore.setState({
        socket: null,
        isConnected: false,
        isAuthenticated: false,
      });

      vi.spyOn(useSocketStore.getState(), "connect").mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      await expect(
        useSocketStore.getState().updateAuth({
          accessToken: "token",
          userId: "u1",
          username: "user1",
          userRole: "GUEST",
        }),
      ).rejects.toThrow("Connection refused");
    });
  });
});
