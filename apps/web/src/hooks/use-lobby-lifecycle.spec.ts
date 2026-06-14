// F8 fix: regression test for the auto-join double-emit guard in
// `useLobbyLifecycle`. The hook's effect depends on `room`, which
// changes on every `PLAYER_JOINED` / presence tick. Without the
// `joinInFlightRef` guard, two rapid effect re-runs would both call
// `joinRoom(roomCode)` before the first one resolved, producing two
// `JOIN_ROOM` emits on the wire.
//
// The previous `cancelled` flag (still in the cleanup) only blocked
// the post-await `setJoining` / `setJoinError` calls; it did NOT
// cancel the in-flight `await joinRoom`. We verify here that the
// new ref-based guard emits `joinRoom` exactly once across a
// rapid sequence of room updates.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We use a mutable holder for the mocked store state so the test
// can flip `room` between null and an object to simulate presence
// ticks / PLAYER_JOINED broadcasts.
type StoreSnapshot = {
  isConnected: boolean;
  userId: string | null;
  username: string | null;
  room: {
    id: string;
    code: string;
    status: string;
    hostId: string;
    joinMode: string;
    players: unknown[];
  } | null;
  joinRoom: ReturnType<typeof vi.fn>;
};

const store: StoreSnapshot = {
  isConnected: true,
  userId: "u1",
  username: "Alice",
  room: null,
  joinRoom: vi.fn(),
};

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: () => ({
    isConnected: store.isConnected,
    userId: store.userId,
    username: store.username,
    room: store.room,
    joinRoom: store.joinRoom,
  }),
}));

import { useLobbyLifecycle } from "./use-lobby-lifecycle";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useLobbyLifecycle — F8 auto-join guard", () => {
  beforeEach(() => {
    store.isConnected = true;
    store.userId = "u1";
    store.username = "Alice";
    store.room = null;
    store.joinRoom = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits joinRoom exactly once even when `room` flips null → object during a pending await", async () => {
    // Make the mock joinRoom a slow-resolving promise so the
    // second effect run can fire BEFORE the first await resolves.
    let resolveJoin: (() => void) | null = null;
    store.joinRoom = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        }),
    );

    const { rerender } = renderHook(
      ({ code }: { code: string }) => useLobbyLifecycle(code),
      { initialProps: { code: "ABC" } },
    );

    // First effect run fired joinRoom once.
    expect(store.joinRoom).toHaveBeenCalledTimes(1);
    expect(store.joinRoom).toHaveBeenCalledWith("ABC");

    // Simulate a rapid room-object update while the await is in
    // flight (presence tick or PLAYER_JOINED). The previous bug
    // would let a second `joinRoom` call through; the new
    // `joinInFlightRef` guard must block it.
    await act(async () => {
      store.room = {
        id: "r1",
        code: "ABC",
        status: "WAITING",
        hostId: "u1",
        joinMode: "PLAYER",
        players: [],
      };
    });
    rerender({ code: "ABC" });

    // Guard held: still exactly one call.
    expect(store.joinRoom).toHaveBeenCalledTimes(1);

    // Drain the in-flight.
    await act(async () => {
      resolveJoin?.();
      await flushPromises();
    });

    // After the in-flight resolves, the next re-render must NOT
    // re-emit (the `room.code === roomCode` short-circuit in the
    // hook handles this).
    rerender({ code: "ABC" });
    expect(store.joinRoom).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh joinRoom after a previous attempt completed (guard releases in finally)", async () => {
    store.joinRoom = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ code }: { code: string }) => useLobbyLifecycle(code),
      { initialProps: { code: "ABC" } },
    );
    expect(store.joinRoom).toHaveBeenCalledTimes(1);

    // Drain the in-flight.
    await act(async () => {
      await flushPromises();
    });

    // Simulate a leave-then-rejoin: the store receives a room
    // update (e.g. PLAYER_LEFT), then the user leaves and
    // `room` is cleared. The guard should have been released
    // in the previous call's `finally`, so this legitimate
    // re-join must be allowed through.
    //
    // We have to flip room to a non-null value first so the
    // effect's dependency array sees a change when we then
    // flip it back to null.
    await act(async () => {
      store.room = {
        id: "r1",
        code: "ABC",
        status: "WAITING",
        hostId: "u1",
        joinMode: "PLAYER",
        players: [],
      };
    });
    rerender({ code: "ABC" });

    await act(async () => {
      store.room = null;
    });
    rerender({ code: "ABC" });

    expect(store.joinRoom).toHaveBeenCalledTimes(2);
    expect(store.joinRoom).toHaveBeenNthCalledWith(2, "ABC");
  });

  it("does not re-emit on the second effect run when room.code === roomCode (the existing short-circuit still holds)", async () => {
    store.joinRoom = vi.fn().mockResolvedValue(undefined);
    store.room = {
      id: "r1",
      code: "ABC",
      status: "WAITING",
      hostId: "u1",
      joinMode: "PLAYER",
      players: [],
    };

    renderHook(({ code }: { code: string }) => useLobbyLifecycle(code), {
      initialProps: { code: "ABC" },
    });

    // We start in the "already in room" state. The hook's
    // first short-circuit (`room.code === roomCode`) should
    // prevent joinRoom from being called at all.
    expect(store.joinRoom).not.toHaveBeenCalled();
  });
});
