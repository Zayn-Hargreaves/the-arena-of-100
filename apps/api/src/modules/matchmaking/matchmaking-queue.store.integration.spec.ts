// ============================================================
// Integration: MatchmakingQueueStore — Real Redis integration
//
// Validates that addTicket() handles ticket-key SET and
// sorted-set ZADD atomically with compensating cleanup on command
// failure:
//
// 1. ZADD command failure: when ZADD fails (e.g. WRONGTYPE), the
//    compensating cleanup removes the ticket key from Redis.
// 2. SET command failure: when SET fails, the compensating cleanup
//    removes the member from the sorted set in Redis.
// 3. Successful path: writes both ticket key and sorted set entry.
//
// Runs under vitest-e2e (vitest-e2e.config.ts) or when local test
// Redis infrastructure is provisioned.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import {
  MatchmakingQueueStore,
  MATCHMAKING_QUEUE_ZSET,
  MATCHMAKING_TICKET_PREFIX,
  type MatchmakingTicket,
} from "./matchmaking-queue.store";
import { RedisService } from "../redis/redis.service";
import { cleanupE2ETestEnv, prepareE2ETestEnv } from "../../../test/setup-e2e";

const currentFileUrl = pathToFileURL(__filename).href;

describe("MatchmakingQueueStore (Redis Integration)", () => {
  let realRedis: RedisService;
  let store: MatchmakingQueueStore;
  let envReady = false;

  beforeAll(async () => {
    try {
      await prepareE2ETestEnv(currentFileUrl);
      envReady = true;
    } catch (err) {
      const isCI = Boolean(process.env.CI);
      if (isCI) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const isMissingOrInvalidLocalTestInfra =
        /DATABASE_URL/i.test(message) ||
        /REDIS_URL/i.test(message) ||
        /E2E (template|tests require)/i.test(message) ||
        /ECONNREFUSED/i.test(message) ||
        /Can't reach database/i.test(message);
      if (isMissingOrInvalidLocalTestInfra) {
        console.warn(
          `[matchmaking-queue.store.integration-spec] Skipping — ${message}`,
        );
        return;
      }
      throw err;
    }

    const { ConfigService } = await import("@nestjs/config");
    const basePrefix = process.env.REDIS_KEY_PREFIX ?? "e2e:mmq:";
    const suiteSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}:`;
    const redisKeyPrefix = `${basePrefix.replace(/:*$/, "")}:${suiteSuffix}`;
    const config = new ConfigService({
      REDIS_URL: process.env.REDIS_URL,
      REDIS_KEY_PREFIX: redisKeyPrefix,
    });
    realRedis = new RedisService(config);
    store = new MatchmakingQueueStore(realRedis);
  });

  afterAll(async () => {
    if (realRedis) {
      await realRedis.onModuleDestroy();
    }
    if (envReady) {
      await cleanupE2ETestEnv(currentFileUrl);
    }
  });

  it("deletes ticket key when ZADD command fails, leaving neither ticket key nor sorted-set member", async () => {
    if (!envReady) return;

    const client = realRedis.getClient();
    const uniqueId = `zadd_fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${uniqueId}`;

    // Force ZADD to fail by populating MATCHMAKING_QUEUE_ZSET with a String instead of a Sorted Set
    await client.set(MATCHMAKING_QUEUE_ZSET, "corrupted_non_zset_string_value");

    const ticket: MatchmakingTicket = {
      userId: uniqueId,
      username: "Player_ZaddFail",
      elo: 1350,
      socketId: `socket_${uniqueId}`,
      joinedAt: Date.now(),
    };

    try {
      await expect(store.addTicket(ticket)).rejects.toThrow();

      // Assert compensating cleanup removed the ticket key
      const ticketVal = await client.get(ticketKey);
      expect(ticketVal).toBeNull();

      // Verify the queue key remains absent as a sorted-set member by checking its Redis type
      const queueType = await client.type(MATCHMAKING_QUEUE_ZSET);
      expect(queueType).toBe("string");
    } finally {
      // Clean up corrupted key and test keys
      await client.del(MATCHMAKING_QUEUE_ZSET);
      await client.del(ticketKey);
    }
  });

  it("removes sorted-set member when SET command result reports failure", async () => {
    if (!envReady) return;

    const client = realRedis.getClient();
    const uniqueId = `set_fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${uniqueId}`;

    const ticket: MatchmakingTicket = {
      userId: uniqueId,
      username: "Player_SetFail",
      elo: 1400,
      socketId: `socket_${uniqueId}`,
      joinedAt: Date.now(),
    };

    // Intercept pipeline to simulate SET command error while executing real ZADD on Redis
    const originalPipeline = client.pipeline.bind(client);
    let pipelineCallCount = 0;
    client.pipeline = () => {
      pipelineCallCount++;
      const pipe = originalPipeline();
      if (pipelineCallCount === 1) {
        const originalExec = pipe.exec.bind(pipe);
        pipe.exec = async () => {
          const results = await originalExec();
          // Replace SET result with error
          if (results && results[0]) {
            results[0] = [new Error("Simulated SET failure"), null];
          }
          return results;
        };
      }
      return pipe;
    };

    try {
      await expect(store.addTicket(ticket)).rejects.toThrow(
        "Simulated SET failure",
      );

      // Assert compensating cleanup removed the sorted-set member
      const zscore = await client.zscore(MATCHMAKING_QUEUE_ZSET, uniqueId);
      expect(zscore).toBeNull();
    } finally {
      client.pipeline = originalPipeline;
      await client.del(ticketKey);
      await client.zrem(MATCHMAKING_QUEUE_ZSET, uniqueId);
    }
  });

  it("persists both ticket key and sorted-set member when addTicket succeeds", async () => {
    if (!envReady) return;

    const client = realRedis.getClient();
    const uniqueId = `ok_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${uniqueId}`;

    const ticket: MatchmakingTicket = {
      userId: uniqueId,
      username: "Player_Success",
      elo: 1500,
      socketId: `socket_${uniqueId}`,
      joinedAt: Date.now(),
    };

    try {
      await store.addTicket(ticket);

      const ticketVal = await client.get(ticketKey);
      expect(ticketVal).not.toBeNull();
      const parsed = JSON.parse(ticketVal!);
      expect(parsed.userId).toBe(uniqueId);
      expect(parsed.elo).toBe(1500);

      const zscore = await client.zscore(MATCHMAKING_QUEUE_ZSET, uniqueId);
      expect(Number(zscore)).toBe(1500);
    } finally {
      await store.removeTicket(uniqueId);
    }
  });
});
