import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { LobbyCountdownService } from "./lobby-countdown.service";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";
import { RoomStatus, GAME_CONFIG } from "@arena/shared";
import { Server } from "socket.io";
import { readPersistedCountdownEnd } from "./game-loop.countdown-store";

vi.mock("./game-loop.countdown-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./game-loop.countdown-store")>();
  return {
    ...actual,
    readPersistedCountdownEnd: vi.fn(),
  };
});

describe("LobbyCountdownService", () => {
  let service: LobbyCountdownService;
  let roomService: RoomService;
  let redisService: any;
  let mockServer: Server;
  let loggerErrorSpy: any;

  beforeEach(() => {
    roomService = {
      getRoom: vi.fn(),
      updateRoomStatus: vi.fn(),
    } as unknown as RoomService;

    redisService = createMockRedisService();

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    service = new LobbyCountdownService(roomService, redisService);
    service.setServer(mockServer);

    loggerErrorSpy = vi
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => {});
    vi.spyOn((service as any).logger, "log").mockImplementation(() => {});
    vi.spyOn((service as any).logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("onModuleInit and dead letter sweeping", () => {
    it("should sweep dead letter rooms when NODE_ENV is not test", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(["room-dl-1"]);
      client.exists.mockResolvedValueOnce(0); // Expired

      try {
        await service.onModuleInit();
        expect(client.smembers).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
        );
        expect(client.exists).toHaveBeenCalledWith(
          "room:recovery:dead-letter:room-dl-1",
        );
        expect(client.srem).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
          "room-dl-1",
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should handle error during sweepDeadLetterRooms", async () => {
      const client = redisService.getClient();
      client.smembers.mockRejectedValueOnce(new Error("Redis connection lost"));

      await (service as any).sweepDeadLetterRooms();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Failed to sweep dead-letter rooms:",
        expect.any(Error),
      );
    });

    it("should return early during sweepDeadLetterRooms if roomIds is null or undefined", async () => {
      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(null);

      await (service as any).sweepDeadLetterRooms();

      expect(client.exists).not.toHaveBeenCalled();
    });

    it("should skip removing dead letter room from set if exists is not 0", async () => {
      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(["room-dl-1"]);
      client.exists.mockResolvedValueOnce(1); // Still valid/exists

      await (service as any).sweepDeadLetterRooms();

      expect(client.srem).not.toHaveBeenCalled();
    });
  });

  describe("maybeStartPublicCountdown persist and rollback failures", () => {
    it("should handle persist failure and rollback room status to WAITING", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        players: new Array(GAME_CONFIG.MIN_PLAYERS_TO_START).fill({
          userId: "p",
        }),
      } as any);

      vi.mocked(roomService.updateRoomStatus).mockResolvedValueOnce({} as any); // COUNTDOWN success

      // Mock Redis client to fail during transaction exec
      const client = redisService.getClient();
      vi.spyOn(client, "multi").mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValueOnce(new Error("Persist failed")),
      } as any);

      await expect(
        service.maybeStartPublicCountdown("room-1", mockServer),
      ).rejects.toThrow("Persist failed");

      expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
        "room-1",
        RoomStatus.WAITING,
      );
    });

    it("should log error if rollback fails after persist failure", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        players: new Array(GAME_CONFIG.MIN_PLAYERS_TO_START).fill({
          userId: "p",
        }),
      } as any);

      vi.mocked(roomService.updateRoomStatus)
        .mockResolvedValueOnce({} as any) // COUNTDOWN success
        .mockRejectedValueOnce(new Error("Database crash")); // Rollback failure

      // Mock Redis client to fail during transaction exec
      const client = redisService.getClient();
      vi.spyOn(client, "multi").mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValueOnce(new Error("Persist failed")),
      } as any);

      await expect(
        service.maybeStartPublicCountdown("room-1", mockServer),
      ).rejects.toThrow("Persist failed");

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to roll back room room-1 to WAITING after countdown persist failure:",
        ),
        expect.any(Error),
      );
    });
  });

  describe("getCountdownEnd non-finite values", () => {
    it("should return null when readPersistedCountdownEnd returns a non-finite value", async () => {
      vi.mocked(readPersistedCountdownEnd).mockResolvedValueOnce({
        kind: "present",
        value: Infinity,
      });

      const result = await service.getCountdownEnd("room-1");
      expect(result).toBeNull();
    });
  });
});
