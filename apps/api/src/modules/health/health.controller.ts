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
  cpuUsage: number;
  memoryUsageMb: number;
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
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthCheckResponse> {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      status: "ok",
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
    const usage = process.cpuUsage();
    const cpuUsage = Math.min(
      100,
      Number(((usage.user + usage.system) / 1_000_000).toFixed(1)),
    );
    const memoryUsageMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const roomCount = await this.getActiveRoomCount();

    return {
      cpuUsage,
      memoryUsageMb,
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
