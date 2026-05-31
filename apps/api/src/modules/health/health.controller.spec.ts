import { RoomStatus } from "@arena/shared";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const createController = () => {
    const prisma = {
      room: {
        count: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };

    const redis = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      getClient: vi.fn(),
    };

    return {
      controller: new HealthController(prisma as never, redis as never),
      prisma,
      redis,
    };
  };

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("check", () => {
    beforeEach(() => {
      vi.spyOn(process, "uptime").mockReturnValue(12345);
    });

    it("returns ok with all services connected", async () => {
      const { controller, prisma, redis } = createController();
      prisma.$queryRaw.mockResolvedValue([{ "1": 1 }]);
      redis.getClient.mockReturnValue({
        ping: vi.fn().mockResolvedValue("PONG"),
      });

      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.services.database).toEqual({
        status: "connected",
        latency: expect.any(Number),
      });
      expect(result.services.redis).toEqual({
        status: "connected",
        latency: expect.any(Number),
      });
      expect(result.uptime).toBe(12345);
      expect(result.timestamp).toEqual(expect.any(String));
    });

    it("handles database failure gracefully", async () => {
      const { controller, prisma, redis } = createController();
      prisma.$queryRaw.mockRejectedValue(new Error("db down"));
      redis.getClient.mockReturnValue({
        ping: vi.fn().mockResolvedValue("PONG"),
      });

      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.services.database).toEqual({ status: "disconnected" });
      expect(result.services.redis.status).toBe("connected");
    });

    it("handles redis failure gracefully", async () => {
      const { controller, prisma, redis } = createController();
      prisma.$queryRaw.mockResolvedValue([{ "1": 1 }]);
      redis.getClient.mockReturnValue({
        ping: vi.fn().mockRejectedValue(new Error("redis down")),
      });

      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.services.database.status).toBe("connected");
      expect(result.services.redis).toEqual({ status: "disconnected" });
    });

    it("handles both services failing", async () => {
      const { controller, prisma, redis } = createController();
      prisma.$queryRaw.mockRejectedValue(new Error("db down"));
      redis.getClient.mockReturnValue({
        ping: vi.fn().mockRejectedValue(new Error("redis down")),
      });

      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.services.database).toEqual({ status: "disconnected" });
      expect(result.services.redis).toEqual({ status: "disconnected" });
    });
  });

  describe("monitoring", () => {
    it("returns cached room count when cache has valid value", async () => {
      const { controller, prisma, redis } = createController();
      redis.get.mockResolvedValue("12");

      const result = await controller.monitoring();

      expect(result.roomCount).toBe(12);
      expect(prisma.room.count).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("queries DB and caches when cache is missing", async () => {
      const { controller, prisma, redis } = createController();
      redis.get.mockResolvedValue(null);
      prisma.room.count.mockResolvedValue(7);
      redis.set.mockResolvedValue(undefined);

      const result = await controller.monitoring();

      expect(result.roomCount).toBe(7);
      expect(prisma.room.count).toHaveBeenCalledWith({
        where: { status: { in: [RoomStatus.WAITING, RoomStatus.IN_GAME] } },
      });
      expect(redis.set).toHaveBeenCalledWith(
        "health:active-room-count",
        "7",
        5,
      );
    });

    it("falls back to DB when cached value is invalid", async () => {
      const { controller, prisma, redis } = createController();
      redis.get.mockResolvedValue("not-a-number");
      prisma.room.count.mockResolvedValue(3);

      const result = await controller.monitoring();

      expect(result.roomCount).toBe(3);
      expect(prisma.room.count).toHaveBeenCalledTimes(1);
    });

    it("falls back to DB when cache read fails", async () => {
      const { controller, prisma, redis } = createController();
      redis.get.mockRejectedValue(new Error("redis down"));
      prisma.room.count.mockResolvedValue(9);

      const result = await controller.monitoring();

      expect(result.roomCount).toBe(9);
      expect(prisma.room.count).toHaveBeenCalledTimes(1);
    });

    it("still returns DB count when cache write fails", async () => {
      const { controller, prisma, redis } = createController();
      redis.get.mockResolvedValue(null);
      prisma.room.count.mockResolvedValue(4);
      redis.set.mockRejectedValue(new Error("write failed"));

      const result = await controller.monitoring();

      expect(result.roomCount).toBe(4);
      expect(prisma.room.count).toHaveBeenCalledTimes(1);
    });
  });
});
