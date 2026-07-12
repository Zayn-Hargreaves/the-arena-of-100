// ============================================================
// Health Controller - System Health Check
// ============================================================

import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { RoomStatus } from "@arena/shared";
import { Roles } from "../../common/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { Public } from "../../common/decorators/public.decorator";
import { CpuSamplerService } from "./services/cpu-sampler.service";
import os from "os";

// ── DTO Types ──────────────────────────────────────────────

type ServiceHealthStatus = "connected" | "disconnected";

interface ServiceHealth {
  status: ServiceHealthStatus;
  latency?: number;
}

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
  };
}

interface MonitoringResponse {
  cpuUsage: number | null;
  // RSS / total memory in bytes. Raw so the k6 load-test sampler can
  // compute exact deltas without losing precision to MB rounding.
  rssBytes: number;
  totalMemBytes: number;
  // Legacy fields kept for backwards compatibility with any consumer
  // that still reads the rounded MB values.
  memoryUsageMb: number;
  totalMemoryMb: number;
  numCpus: number;
  roomCount: number;
  timestamp: string;
}

// ── Constants ──────────────────────────────────────────────

const MONITORING_ROOM_COUNT_CACHE_KEY = "health:active-room-count";
const MONITORING_ROOM_COUNT_CACHE_TTL_SECONDS = 5;

// ── Controller ─────────────────────────────────────────────

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cpuSampler: CpuSamplerService,
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthCheckResponse> {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const allHealthy =
      databaseHealth.status === "connected" &&
      redisHealth.status === "connected";

    return {
      status: allHealthy ? "ok" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: databaseHealth,
        redis: redisHealth,
      },
    };
  }

  @Get("monitoring")
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  async monitoring(): Promise<MonitoringResponse> {
    const cpuUsage = this.cpuSampler.sample();

    const mem = process.memoryUsage();
    const rssBytes = mem.rss;
    const totalMemBytes = os.totalmem();
    const memoryUsageMb = Math.round(rssBytes / (1024 * 1024));
    const totalMemoryMb = Math.round(totalMemBytes / (1024 * 1024));
    const numCpus = os.cpus().length;
    const roomCount = await this.getActiveRoomCount();

    return {
      cpuUsage,
      rssBytes,
      totalMemBytes,
      memoryUsageMb,
      totalMemoryMb,
      numCpus,
      roomCount,
      timestamp: new Date().toISOString(),
    };
  }

  private async getActiveRoomCount(): Promise<number> {
    try {
      const cachedRoomCount = await this.redis.get(
        MONITORING_ROOM_COUNT_CACHE_KEY,
      );
      if (cachedRoomCount) {
        const parsedRoomCount = Number(cachedRoomCount);
        if (Number.isFinite(parsedRoomCount) && parsedRoomCount >= 0) {
          return parsedRoomCount;
        }
      }
    } catch {
      // Fall back to DB query when cache read fails.
    }

    const roomCount = await this.prisma.room.count({
      where: { status: { in: [RoomStatus.WAITING, RoomStatus.IN_GAME] } },
    });

    void this.redis
      .set(
        MONITORING_ROOM_COUNT_CACHE_KEY,
        String(roomCount),
        MONITORING_ROOM_COUNT_CACHE_TTL_SECONDS,
      )
      .catch(() => undefined);

    return roomCount;
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "connected",
        latency: Date.now() - start,
      };
    } catch {
      return { status: "disconnected" };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    try {
      const start = Date.now();
      await this.redis.getClient().ping();
      return {
        status: "connected",
        latency: Date.now() - start,
      };
    } catch {
      return { status: "disconnected" };
    }
  }
}
