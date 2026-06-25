import { ClientEvent, ErrorCode, ServerEvent } from "@arena/shared";
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
});
