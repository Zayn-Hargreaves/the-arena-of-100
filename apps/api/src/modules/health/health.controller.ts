// ============================================================
// Health Controller - System Health Check
// ============================================================

import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
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
