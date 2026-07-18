// ============================================================
// Health Controller - System Health Check
// ============================================================

import { Controller, Get, NotFoundException } from "@nestjs/common";
import { ApiBearerAuth } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { RoomStatus } from "@arena/shared";
import { Roles } from "../../common/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { Public } from "../../common/decorators/public.decorator";
import { CpuSamplerService } from "./services/cpu-sampler.service";
import { EventLoopLagService } from "./services/event-loop-lag.service";
import { ClusterService } from "../cluster/cluster.service";
import { MatchOwnershipService } from "../match/match-ownership.service";
import os from "node:os";

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

interface ClusterHealthResponse {
  // Stable per-instance identity (INSTANCE_ID env or hostname). Also the
  // value written into the Redis owner-lease from Stage B on.
  nodeId: string;
  uptime: number;
  // Matches this node currently owns (drives the round loop for). Empty
  // until the Stage B owner-lease lands. The chaos-failover script reads
  // this per node to pick which container to kill and to confirm the
  // lease moved after the kill.
  ownedMatches: string[];
  // Sockets on THIS node's /game namespace — used to assert the load
  // actually spread across nodes (distribution check).
  socketCount: number;
  // B2c: max inter-node clock skew (ms) = max(offset) - min(offset) across live
  // members. Warn at 1s, page at 2s. 0 with fewer than two live nodes.
  maxSkew: number;
  timestamp: string;
}

interface MonitoringResponse {
  cpuUsage: number | null;
  // Real event-loop stall, not just CPU busy-ness — sampled continuously
  // via perf_hooks.monitorEventLoopDelay and reset on each read (same
  // delta-per-call convention as cpuUsage).
  eventLoopLagMaxMs: number | null;
  eventLoopLagMeanMs: number | null;
  eventLoopLagP99Ms: number | null;
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
    private readonly eventLoopLag: EventLoopLagService,
    private readonly cluster: ClusterService,
    // B2b: ownership moved off ClusterService (which now only knows nodeId);
    // read the owned-match view from its authoritative in-memory owner.
    private readonly matchOwnership: MatchOwnershipService,
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

  // Only expose the per-node topology view on the explicit multi-node
  // deployment (`INSTANCE_ID` set per replica). Single-node production keeps
  // this endpoint hidden so nodeId / ownedMatches / socketCount stay private.
  @Get("cluster")
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  async clusterHealth(): Promise<ClusterHealthResponse> {
    if (process.env.NODE_ENV === "production" && !process.env.INSTANCE_ID) {
      throw new NotFoundException();
    }

    return {
      nodeId: this.cluster.nodeId,
      uptime: process.uptime(),
      ownedMatches: this.matchOwnership.getOwnedMatchIds(),
      socketCount: this.cluster.getLocalSocketCount(),
      maxSkew: await this.matchOwnership.computeMaxSkew(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("monitoring")
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  async monitoring(): Promise<MonitoringResponse> {
    const cpuUsage = this.cpuSampler.sample();
    const lag = this.eventLoopLag.sample();

    const mem = process.memoryUsage();
    const rssBytes = mem.rss;
    const totalMemBytes = os.totalmem();
    const memoryUsageMb = Math.round(rssBytes / (1024 * 1024));
    const totalMemoryMb = Math.round(totalMemBytes / (1024 * 1024));
    const numCpus = os.cpus().length;
    const roomCount = await this.getActiveRoomCount();

    return {
      cpuUsage,
      eventLoopLagMaxMs: lag?.maxMs ?? null,
      eventLoopLagMeanMs: lag?.meanMs ?? null,
      eventLoopLagP99Ms: lag?.p99Ms ?? null,
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
