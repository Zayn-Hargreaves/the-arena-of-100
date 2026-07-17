import { RoomStatus } from "@arena/shared";
import os from "os";
import {
  NotFoundException,
  VersioningType,
  UnauthorizedException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { APP_GUARD } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator";
import { ROLES_KEY } from "../../common/decorators/roles.decorator";
import { HealthController } from "./health.controller";
import { CpuSamplerService } from "./services/cpu-sampler.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ClusterService } from "../cluster/cluster.service";

describe("HealthController", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_INSTANCE_ID = process.env.INSTANCE_ID;

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

    const cpuSampler = new CpuSamplerService();

    const cluster = {
      nodeId: "test-node",
      getOwnedMatchIds: vi.fn().mockResolvedValue([]),
      getLocalSocketCount: vi.fn().mockReturnValue(0),
    };

    return {
      controller: new HealthController(
        prisma as never,
        redis as never,
        cpuSampler,
        cluster as never,
      ),
      prisma,
      redis,
      cpuSampler,
      cluster,
    };
  };

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();

    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;

    if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.INSTANCE_ID;
    else process.env.INSTANCE_ID = ORIGINAL_INSTANCE_ID;
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

      expect(result.status).toBe("unhealthy");
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

      expect(result.status).toBe("unhealthy");
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

      expect(result.status).toBe("unhealthy");
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

    it("returns null cpuUsage on first call (cold start)", async () => {
      const { controller, prisma, redis } = createController();
      prisma.room.count.mockResolvedValue(0);
      redis.get.mockResolvedValue(null);

      const result = await controller.monitoring();

      expect(result.cpuUsage).toBeNull();
    });

    it("calculates delta CPU usage from mocked process.cpuUsage and Date.now", async () => {
      const { controller, prisma, redis } = createController();
      prisma.room.count.mockResolvedValue(0);
      redis.get.mockResolvedValue(null);

      const cpuSpy = vi.spyOn(process, "cpuUsage");
      const nowSpy = vi.spyOn(Date, "now");

      nowSpy.mockReturnValueOnce(1_000_000);
      cpuSpy.mockReturnValueOnce({ user: 1_000_000, system: 500_000 });
      await controller.monitoring();

      nowSpy.mockReturnValueOnce(1_001_000);
      cpuSpy.mockReturnValueOnce({ user: 1_200_000, system: 600_000 });
      const result = await controller.monitoring();

      const deltaCpuMicros = 1_200_000 + 600_000 - (1_000_000 + 500_000);
      const elapsedMs = 1_001_000 - 1_000_000;
      const numCpus = os.cpus().length;
      // Plan A: cpuUsage is reported as "% of 1 core".
      const expected = Math.min(
        100 * numCpus,
        (deltaCpuMicros / 1000 / elapsedMs) * 100,
      );

      expect(result.cpuUsage).not.toBeNull();
      expect(result.cpuUsage).toBeCloseTo(expected, 5);
    });

    it("caps delta CPU usage at 100 * numCpus (fully loaded host)", async () => {
      const { controller, prisma, redis } = createController();
      prisma.room.count.mockResolvedValue(0);
      redis.get.mockResolvedValue(null);

      const cpuSpy = vi.spyOn(process, "cpuUsage");
      const nowSpy = vi.spyOn(Date, "now");

      nowSpy.mockReturnValueOnce(1_000_000);
      cpuSpy.mockReturnValueOnce({ user: 0, system: 0 });
      await controller.monitoring();

      nowSpy.mockReturnValueOnce(1_001_000);
      cpuSpy.mockReturnValueOnce({
        user: 1_000_000_000,
        system: 1_000_000_000,
      });
      const result = await controller.monitoring();

      const numCpus = os.cpus().length;
      expect(result.cpuUsage).toBe(100 * numCpus);
    });

    it("exposes raw rssBytes / totalMemBytes alongside legacy MB fields", async () => {
      const { controller, prisma, redis } = createController();
      prisma.room.count.mockResolvedValue(0);
      redis.get.mockResolvedValue(null);

      const result = await controller.monitoring();

      expect(typeof result.rssBytes).toBe("number");
      expect(result.rssBytes).toBeGreaterThan(0);
      expect(typeof result.totalMemBytes).toBe("number");
      expect(result.totalMemBytes).toBeGreaterThan(0);
      expect(result.memoryUsageMb).toBe(
        Math.round(result.rssBytes / (1024 * 1024)),
      );
      expect(result.totalMemoryMb).toBe(
        Math.round(result.totalMemBytes / (1024 * 1024)),
      );
      expect(result.numCpus).toBe(os.cpus().length);
    });

    it("isolates CPU tracking between sampler instances", async () => {
      // In production all controllers share a single CpuSamplerService
      // (Nest DI singleton). In tests we construct a fresh sampler per
      // controller so this verifies that the sampler — not the
      // controller — owns the baseline state.
      const { controller: c1, prisma: p1, redis: r1 } = createController();
      const { controller: c2, prisma: p2, redis: r2 } = createController();
      p1.room.count.mockResolvedValue(0);
      p2.room.count.mockResolvedValue(0);
      r1.get.mockResolvedValue(null);
      r2.get.mockResolvedValue(null);

      await c1.monitoring();
      await c1.monitoring();

      const r2First = await c2.monitoring();

      expect(r2First.cpuUsage).toBeNull();
    });
  });

  describe("clusterHealth", () => {
    it("is not public and requires admin role metadata", () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HealthController.prototype,
        "clusterHealth",
      );

      expect(descriptor).toBeDefined();
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, descriptor?.value),
      ).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, descriptor?.value)).toEqual([
        Role.ADMIN,
      ]);
    });

    it("reports node identity, owned matches, and local socket count", async () => {
      process.env.NODE_ENV = "production";
      process.env.INSTANCE_ID = "api-1";

      const { controller, cluster } = createController();
      cluster.getOwnedMatchIds.mockResolvedValue(["match-a", "match-b"]);
      cluster.getLocalSocketCount.mockReturnValue(42);

      const result = await controller.clusterHealth();

      expect(result.nodeId).toBe("test-node");
      expect(result.ownedMatches).toEqual(["match-a", "match-b"]);
      expect(result.socketCount).toBe(42);
      expect(typeof result.uptime).toBe("number");
      expect(result.timestamp).toEqual(expect.any(String));
    });

    it("hides the cluster endpoint in single-node production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.INSTANCE_ID;

      const { controller } = createController();

      await expect(controller.clusterHealth()).rejects.toThrow(
        NotFoundException,
      );
    });

    describe("clusterHealth Integration/E2E", () => {
      let app: NestFastifyApplication;
      let originalNodeEnv: string | undefined;
      let originalInstanceId: string | undefined;

      const mockPrismaService = {
        room: {
          count: vi.fn(),
        },
        $queryRaw: vi.fn(),
      };

      const mockRedisService = {
        get: vi.fn(),
        set: vi.fn().mockResolvedValue(undefined),
        getClient: vi.fn().mockReturnValue({
          ping: vi.fn().mockResolvedValue("PONG"),
        }),
      };

      const mockCpuSampler = {
        sample: vi.fn().mockReturnValue(12.5),
      };

      const mockCluster = {
        nodeId: "test-node",
        getOwnedMatchIds: vi.fn().mockResolvedValue([]),
        getLocalSocketCount: vi.fn().mockReturnValue(0),
      };

      const mockAuthService = {
        verifyToken: vi.fn((token: string) => {
          if (token === "valid-admin-token") {
            return { userId: "admin-1", username: "admin", role: Role.ADMIN };
          }
          if (token === "valid-user-token") {
            return { userId: "user-1", username: "user", role: Role.GUEST };
          }
          throw new UnauthorizedException("Invalid or expired token");
        }),
      };

      beforeAll(async () => {
        originalNodeEnv = process.env.NODE_ENV;
        originalInstanceId = process.env.INSTANCE_ID;
        process.env.NODE_ENV = "test";

        const moduleRef = await Test.createTestingModule({
          controllers: [HealthController],
          providers: [
            { provide: PrismaService, useValue: mockPrismaService },
            { provide: RedisService, useValue: mockRedisService },
            { provide: CpuSamplerService, useValue: mockCpuSampler },
            { provide: ClusterService, useValue: mockCluster },
            { provide: AuthService, useValue: mockAuthService },
            {
              provide: APP_GUARD,
              useClass: JwtAuthGuard,
            },
            {
              provide: APP_GUARD,
              useClass: RolesGuard,
            },
          ],
        }).compile();

        app = moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
        app.setGlobalPrefix("api");
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        await app.init();
      });

      beforeEach(() => {
        // The OUTER afterEach restores NODE_ENV/INSTANCE_ID after EVERY test,
        // which would undo the one-time beforeAll setup above for the second
        // test onward. Re-assert the environment before each test so every
        // test in this block is independent of that restoration.
        process.env.NODE_ENV = "test";
        delete process.env.INSTANCE_ID;
      });

      afterAll(async () => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;

        if (originalInstanceId === undefined) delete process.env.INSTANCE_ID;
        else process.env.INSTANCE_ID = originalInstanceId;

        await app.close();
      });

      it("returns 401 Unauthorized for anonymous requests", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/health/cluster",
        });
        expect(res.statusCode).toBe(401);
      });

      it("returns 403 Forbidden for authenticated non-admin requests", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/health/cluster",
          headers: {
            authorization: "Bearer valid-user-token",
          },
        });
        expect(res.statusCode).toBe(403);
      });

      it("returns 200 OK for admin requests", async () => {
        mockCluster.getOwnedMatchIds.mockResolvedValue(["match-x"]);
        mockCluster.getLocalSocketCount.mockReturnValue(5);

        const res = await app.inject({
          method: "GET",
          url: "/api/v1/health/cluster",
          headers: {
            authorization: "Bearer valid-admin-token",
          },
        });
        expect(res.statusCode).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.nodeId).toBe("test-node");
        expect(body.ownedMatches).toEqual(["match-x"]);
        expect(body.socketCount).toBe(5);
      });
    });
  });
});
