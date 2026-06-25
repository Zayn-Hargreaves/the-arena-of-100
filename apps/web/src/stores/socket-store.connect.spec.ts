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
});
