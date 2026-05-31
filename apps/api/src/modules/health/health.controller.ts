// ============================================================
// Health Controller - System Health Check
// ============================================================

import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { Public } from "../../common/decorators/public.decorator";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  async check() {
    const checks = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: await this.checkDatabase(),
        redis: await this.checkRedis(),
      },
    };

    return checks;
  }

  @Get("monitoring")
  @Public()
  async monitoring() {
    const usage = process.cpuUsage();
    const cpuUsage = Math.min(
      100,
      Number(((usage.user + usage.system) / 1_000_000).toFixed(1)),
    );
    const memoryUsageMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const roomCount = await this.prisma.room.count({
      where: { status: { in: ["WAITING", "IN_GAME"] } },
    });

    return {
      cpuUsage,
      memoryUsageMb,
      roomCount,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<{ status: string; latency?: number }> {
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

  private async checkRedis(): Promise<{ status: string; latency?: number }> {
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
