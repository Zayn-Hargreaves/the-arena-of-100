import {
  ClientEvent,
  ErrorCode,
  ServerEvent,
  PlayerStatus,
  MatchStatus,
  type SnapshotPayload,
  type VoteBanTopicPayload,
} from "@arena/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const waitForSocketAckMock = vi.hoisted(() => vi.fn());

vi.mock("./socket-store.helpers", async () => {
  const actual = await vi.importActual<typeof import("./socket-store.helpers")>(
    "./socket-store.helpers",
  );
  return {
    ...actual,
    waitForSocketAck: waitForSocketAckMock,
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

  it("keeps the heartbeat interval owned by the latest socket", async () => {
    const firstAuth = deferred<void>();
    waitForSocketAckMock
      .mockReturnValueOnce(firstAuth.promise)
      .mockResolvedValueOnce(undefined);

    const intervalToken = { id: "heartbeat-interval" } as const;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(
        intervalToken as unknown as ReturnType<typeof setInterval>,
      );

    let socket1: ReturnType<typeof useSocketStore.getState>["socket"] = null;
    let socket2: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      const firstConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket1 = useSocketStore.getState().socket;
      const secondConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBe(socket1),
      );
      socket2 = useSocketStore.getState().socket;

      await secondConnect;
      firstAuth.resolve();
      await firstConnect;

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 25000);
      expect(useSocketStore.getState().socket).toBe(socket2);
      expect(useSocketStore.getState().heartbeatInterval).toBe(intervalToken);
    } finally {
      socket1?.disconnect();
      socket2?.disconnect();
      setIntervalSpy.mockRestore();
    }
  });

  it("ignores stale socket errors when clearing pending answers", async () => {
    const firstAuth = deferred<void>();
    waitForSocketAckMock
      .mockReturnValueOnce(firstAuth.promise)
      .mockResolvedValueOnce(undefined);

    let socket1: ReturnType<typeof useSocketStore.getState>["socket"] = null;
    let socket2: ReturnType<typeof useSocketStore.getState>["socket"] = null;

    try {
      const firstConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBeNull(),
      );
      socket1 = useSocketStore.getState().socket;
      const secondConnect = useSocketStore.getState().connect();
      await vi.waitFor(() =>
        expect(useSocketStore.getState().socket).not.toBe(socket1),
      );
      socket2 = useSocketStore.getState().socket;
      await secondConnect;

      useSocketStore.setState({
        pendingAnswer: {
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
        },
      });
      socket1?.emit(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "late",
      });

      expect(useSocketStore.getState().pendingAnswer?.submissionId).toBe("s1");

      firstAuth.resolve();
      await firstConnect;
    } finally {
      socket1?.disconnect();
      socket2?.disconnect();
    }
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
    it("rolls back two consecutive votes correctly when both receive matching error payloads", async () => {
      waitForSocketAckMock.mockResolvedValueOnce(undefined);
      let socket: ReturnType<typeof useSocketStore.getState>["socket"] = null;

      try {
        await useSocketStore.getState().connect();
        socket = useSocketStore.getState().socket;
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

        const vote1Call = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "SCIENCE",
        );
        expect(vote1Call).toBeDefined();
        const commandId1 = (vote1Call![1] as VoteBanTopicPayload).commandId;
        expect(typeof commandId1).toBe("string");

        // Vote 2: cast subsequent vote for HISTORY
        useSocketStore.getState().voteBanTopic("m1", "HISTORY");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );

        const vote2Call = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "HISTORY",
        );
        expect(vote2Call).toBeDefined();
        const commandId2 = (vote2Call![1] as VoteBanTopicPayload).commandId;
        expect(typeof commandId2).toBe("string");
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
        await useSocketStore.getState().connect();
        socket = useSocketStore.getState().socket;
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

        const vote1Call = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "SCIENCE",
        );
        expect(vote1Call).toBeDefined();
        const commandId1 = (vote1Call![1] as VoteBanTopicPayload).commandId;
        expect(typeof commandId1).toBe("string");

        // Vote 2: cast subsequent vote for HISTORY
        useSocketStore.getState().voteBanTopic("m1", "HISTORY");
        expect(useSocketStore.getState().topicVoting?.myVotedTopic).toBe(
          "HISTORY",
        );

        const vote2Call = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "HISTORY",
        );
        expect(vote2Call).toBeDefined();
        const commandId2 = (vote2Call![1] as VoteBanTopicPayload).commandId;
        expect(typeof commandId2).toBe("string");
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
        await useSocketStore.getState().connect();
        socket = useSocketStore.getState().socket;
        let isConnected = true;
        Object.defineProperty(socket, "connected", {
          configurable: true,
          get: () => isConnected,
          set: (v) => {
            isConnected = v;
          },
        });

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
        await useSocketStore.getState().connect();
        socket = useSocketStore.getState().socket;
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
        const voteCall = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "SCIENCE",
        );
        const commandId = (voteCall![1] as VoteBanTopicPayload).commandId;

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
        const voteCallFinished = emitSpy.mock.calls.find(
          (c) =>
            c[0] === ClientEvent.VOTE_BAN_TOPIC &&
            (c[1] as VoteBanTopicPayload | undefined)?.topic === "HISTORY",
        );
        const commandIdFinished = (voteCallFinished![1] as VoteBanTopicPayload)
          .commandId;

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
});
