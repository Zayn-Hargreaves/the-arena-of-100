import { Server } from "socket.io";
import { ServerEvent, RoomStatus } from "@arena/shared";
import { vi, beforeEach, afterEach, it, expect, describe } from "vitest";
import { PresenceService } from "./presence.service";
import { RoomService } from "../room/room.service";
import { GameLoopService } from "./game-loop.service";

/**
 * Build a mock server whose `.to(channel)` returns a fresh emitter
 * that records every event the sweep broadcasts. Each call to `.to()`
 * produces a new emitter so we can inspect emissions per channel.
 */
function makeMockServer() {
  const emissions: Array<{
    channel: string;
    event: string;
    payload: unknown;
  }> = [];
  const to = vi.fn((channel: string) => ({
    emit: vi.fn((event: string, payload: unknown) => {
      emissions.push({ channel, event, payload });
      return true;
    }),
  }));
  return { to, emissions } as unknown as Server & {
    to: ReturnType<typeof vi.fn>;
    emissions: typeof emissions;
  };
}

function makeActiveRoom(
  overrides: Partial<{
    id: string;
    code: string;
    type: "PUBLIC" | "PRIVATE";
    hostId: string;
    status: RoomStatus;
    maxPlayers: number;
    timeLimit: number;
    category: string;
    currentMatchId: string | null;
    createdAt: Date;
    updatedAt: Date;
    players: Array<
      Partial<{ id: string; roomId: string; userId: string; joinedAt: Date }>
    >;
  }> = {},
) {
  const roomId = overrides.id || "r1";
  const players = (
    overrides.players || [{ userId: "p1" }, { userId: "p2" }]
  ).map((p, idx) => ({
    id: p.id || `rp-${roomId}-${idx}`,
    roomId: p.roomId || roomId,
    userId: p.userId || `p-${idx}`,
    joinedAt: p.joinedAt || new Date(),
  }));
  return {
    id: roomId,
    code: "ABC123",
    type: "PUBLIC" as const,
    hostId: "host1",
    status: RoomStatus.WAITING,
    maxPlayers: 100,
    timeLimit: 15,
    category: "ALL",
    currentMatchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    players,
  };
}

describe("PresenceService", () => {
  let service: PresenceService;
  let roomService: RoomService;
  let gameLoopService: {
    handleRoomPlayerLeft: ReturnType<typeof vi.fn>;
  };
  let mockServer: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    roomService = {
      updatePresence: vi.fn().mockResolvedValue(undefined),
      clearPresence: vi.fn().mockResolvedValue(undefined),
      checkPresence: vi.fn().mockResolvedValue(true),
      getActiveRooms: vi.fn().mockResolvedValue([]),
      removePlayerBatch: vi.fn().mockResolvedValue(undefined),
      disbandRoom: vi.fn().mockResolvedValue(undefined),
    } as unknown as RoomService;

    gameLoopService = {
      handleRoomPlayerLeft: vi.fn().mockResolvedValue(undefined),
    };

    mockServer = makeMockServer();

    service = new PresenceService(
      roomService,
      gameLoopService as unknown as GameLoopService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // === Presence passthroughs ===

  describe("presence passthroughs", () => {
    it("updatePresence delegates to roomService", async () => {
      await service.updatePresence("r1", "u1");
      expect(roomService.updatePresence).toHaveBeenCalledWith("r1", "u1");
    });

    it("clearPresence delegates to roomService", async () => {
      await service.clearPresence("r1", "u1");
      expect(roomService.clearPresence).toHaveBeenCalledWith("r1", "u1");
    });

    it("isPresent delegates to roomService and returns the flag", async () => {
      vi.mocked(roomService.checkPresence).mockResolvedValueOnce(true);
      await expect(service.isPresent("r1", "u1")).resolves.toBe(true);
      expect(roomService.checkPresence).toHaveBeenCalledWith("r1", "u1");
    });
  });

  // === sweep() direct invocation ===

  describe("sweep()", () => {
    it("returns early when no server has been injected", async () => {
      // No setServer() call
      await (service as any).sweep();
      expect(roomService.getActiveRooms).not.toHaveBeenCalled();
    });

    it("is a no-op when there are no active rooms", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([]);

      await (service as any).sweep();

      expect(roomService.getActiveRooms).toHaveBeenCalledTimes(1);
      expect(roomService.checkPresence).not.toHaveBeenCalled();
      expect(roomService.removePlayerBatch).not.toHaveBeenCalled();
      expect(roomService.disbandRoom).not.toHaveBeenCalled();
    });

    it("does nothing when every player is still present", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([
        makeActiveRoom(),
      ]);
      vi.mocked(roomService.checkPresence).mockResolvedValue(true);

      await (service as any).sweep();

      expect(roomService.checkPresence).toHaveBeenCalledTimes(2);
      expect(roomService.removePlayerBatch).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
      expect(gameLoopService.handleRoomPlayerLeft).not.toHaveBeenCalled();
    });

    it("removes stale non-host players, emits PLAYER_LEFT (STALE), and triggers handleRoomPlayerLeft", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([
        makeActiveRoom({
          id: "r9",
          hostId: "host1",
          players: [{ userId: "host1" }, { userId: "p2" }],
        }),
      ]);
      vi.mocked(roomService.checkPresence).mockImplementation(
        async (_room, userId) => userId !== "p2",
      );

      await (service as any).sweep();

      expect(roomService.removePlayerBatch).toHaveBeenCalledWith("r9", ["p2"]);
      // One PLAYER_LEFT per stale player on `room:r9`
      const playerLeftEmits = mockServer.emissions.filter(
        (e) => e.event === ServerEvent.PLAYER_LEFT,
      );
      expect(playerLeftEmits).toHaveLength(1);
      expect(playerLeftEmits[0]).toMatchObject({
        channel: "room:r9",
        event: ServerEvent.PLAYER_LEFT,
        payload: { roomId: "r9", playerId: "p2", reason: "STALE" },
      });
      expect(gameLoopService.handleRoomPlayerLeft).toHaveBeenCalledWith(
        "r9",
        mockServer,
      );
    });

    it("disbands a PRIVATE room whose host is stale, emitting HOST_STALE events", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([
        makeActiveRoom({
          id: "rPriv",
          code: "PRIV1",
          type: "PRIVATE",
          hostId: "host1",
          players: [{ userId: "host1" }, { userId: "p2" }],
        }),
      ]);
      vi.mocked(roomService.checkPresence).mockImplementation(
        async (_room, userId) => userId !== "host1", // host is stale
      );

      await (service as any).sweep();

      expect(roomService.disbandRoom).toHaveBeenCalledWith("rPriv");
      // Batch removal MUST NOT be called in the host-stale path
      expect(roomService.removePlayerBatch).not.toHaveBeenCalled();

      const cancelled = mockServer.emissions.find(
        (e) => e.event === ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      );
      expect(cancelled).toMatchObject({
        channel: "room:rPriv",
        event: ServerEvent.ROOM_COUNTDOWN_CANCELLED,
        payload: expect.objectContaining({
          roomId: "rPriv",
          reason: "HOST_STALE",
        }),
      });

      const hostLeft = mockServer.emissions.find(
        (e) =>
          e.event === ServerEvent.PLAYER_LEFT &&
          (e.payload as { playerId?: string }).playerId === "host1",
      );
      expect(hostLeft).toMatchObject({
        channel: "room:rPriv",
        event: ServerEvent.PLAYER_LEFT,
        payload: { roomId: "rPriv", playerId: "host1", reason: "HOST_STALE" },
      });

      // No handleRoomPlayerLeft call (the room is being disbanded)
      expect(gameLoopService.handleRoomPlayerLeft).not.toHaveBeenCalled();
    });

    it("treats a stale host in a PUBLIC room as a regular batch removal (not disband)", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([
        makeActiveRoom({
          id: "rPub",
          type: "PUBLIC",
          hostId: "host1",
          players: [{ userId: "host1" }, { userId: "p2" }],
        }),
      ]);
      vi.mocked(roomService.checkPresence).mockImplementation(
        async (_room, userId) => userId !== "host1", // host is stale
      );

      await (service as any).sweep();

      // Public + stale host must NOT disband
      expect(roomService.disbandRoom).not.toHaveBeenCalled();
      expect(roomService.removePlayerBatch).toHaveBeenCalledWith("rPub", [
        "host1",
      ]);
      const playerLeftEmits = mockServer.emissions.filter(
        (e) => e.event === ServerEvent.PLAYER_LEFT,
      );
      expect(playerLeftEmits).toHaveLength(1);
      expect(playerLeftEmits[0].payload).toMatchObject({
        roomId: "rPub",
        playerId: "host1",
        reason: "STALE",
      });
    });

    it("processes multiple rooms in one sweep", async () => {
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValueOnce([
        makeActiveRoom({ id: "r1", players: [{ userId: "p1" }] }),
        makeActiveRoom({ id: "r2", players: [{ userId: "p2" }] }),
      ]);
      // Both rooms have a stale player so removePlayerBatch fires twice
      vi.mocked(roomService.checkPresence).mockResolvedValue(false);

      await (service as any).sweep();

      expect(roomService.removePlayerBatch).toHaveBeenCalledTimes(2);
      expect(roomService.removePlayerBatch).toHaveBeenNthCalledWith(1, "r1", [
        "p1",
      ]);
      expect(roomService.removePlayerBatch).toHaveBeenNthCalledWith(2, "r2", [
        "p2",
      ]);
    });
  });

  // === Lifecycle (interval / destroy) ===

  describe("lifecycle", () => {
    it("onModuleInit arms a 5s sweep interval", () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(global, "setInterval");

      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });

    it("the interval callback calls sweep and awaits it before re-arming", async () => {
      vi.useFakeTimers();
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockResolvedValue([]);

      service.onModuleInit();

      // Advance past one tick — this fires the interval AND flushes microtasks
      await vi.advanceTimersByTimeAsync(5000);

      expect(roomService.getActiveRooms).toHaveBeenCalledTimes(1);
    });

    it("the interval callback catches and logs errors thrown by sweep", async () => {
      vi.useFakeTimers();
      service.setServer(mockServer as unknown as Server);
      vi.mocked(roomService.getActiveRooms).mockRejectedValueOnce(
        new Error("redis down"),
      );
      const errorSpy = vi.spyOn((service as any).logger, "error");

      service.onModuleInit();
      await vi.advanceTimersByTimeAsync(5000);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("redis down"),
        expect.any(String),
      );
      // isSweeping must reset even after a throw
      expect((service as any).isSweeping).toBe(false);
    });

    it("isSweeping reentrancy guard: a second tick is skipped while the first sweep is still running", async () => {
      vi.useFakeTimers();
      service.setServer(mockServer as unknown as Server);

      // Make the first sweep hang on getActiveRooms so isSweeping stays true
      const firstCall = new Promise<any[]>(() => {});
      vi.mocked(roomService.getActiveRooms)
        .mockReturnValueOnce(firstCall)
        .mockResolvedValueOnce([]);

      service.onModuleInit();

      // First tick starts the first sweep (which is still pending on the promise)
      await vi.advanceTimersByTimeAsync(5000);
      expect((service as any).isSweeping).toBe(true);

      // Second tick should detect isSweeping=true and bail without calling getActiveRooms again
      await vi.advanceTimersByTimeAsync(5000);
      expect(roomService.getActiveRooms).toHaveBeenCalledTimes(1);
    });

    it("onModuleDestroy clears the interval", () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("onModuleDestroy is a no-op when onModuleInit was never called", () => {
      // Should not throw when sweepInterval is undefined
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
