import type { Logger } from "@nestjs/common";
import type { RedisService } from "../redis/redis.service";

/** Per-node clock-offset key TTL (short; pruned on read when expired). */
export const NODE_CLOCK_TTL_SEC = 15;
/** SET index of live node ids publishing a clock offset. */
export const NODE_CLOCKS_INDEX = "node:clocks";

const nodeClockKey = (nodeId: string): string => `node:clock:${nodeId}`;

interface ClockTelemetryContext {
  redis: RedisService;
  logger: Logger;
}

export async function publishClockOffset(
  context: ClockTelemetryContext,
  nodeId: string,
): Promise<void> {
  try {
    const redisMs = await context.redis.serverTimeMs();
    const offset = Date.now() - redisMs;
    await context.redis.set(
      nodeClockKey(nodeId),
      String(offset),
      NODE_CLOCK_TTL_SEC,
    );
    await context.redis.sadd(NODE_CLOCKS_INDEX, nodeId);
  } catch (err) {
    context.logger.warn(
      `publishClockOffset failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function computeMaxClockSkew(
  redis: RedisService,
): Promise<number> {
  const members = await redis.smembers(NODE_CLOCKS_INDEX);
  const offsets: number[] = [];
  const values = await Promise.all(
    members.map(async (nodeId) => ({
      nodeId,
      raw: await redis.get(nodeClockKey(nodeId)),
    })),
  );
  const staleNodeIds: string[] = [];
  for (const { nodeId, raw } of values) {
    if (raw === null) {
      staleNodeIds.push(nodeId);
      continue;
    }
    const offset = Number(raw);
    if (Number.isFinite(offset)) offsets.push(offset);
  }
  if (staleNodeIds.length > 0) {
    await redis.srem(NODE_CLOCKS_INDEX, ...staleNodeIds);
  }
  if (offsets.length < 2) return 0;
  return Math.max(...offsets) - Math.min(...offsets);
}
