// ============================================================
// Redis helpers for e2e tests.
//
// The leaderboard endpoint caches results for 60s. To make
// cache-hit/miss tests deterministic, expose a `flushDb` helper
// that wipes only the dedicated test Redis DB (index 1).
// ============================================================

import Redis from "ioredis";

let client: Redis | null = null;

function testRedisDbIndex(): number {
  const envValue = process.env.REDIS_TEST_DB;
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const pathname = new URL(redisUrl()).pathname;
  const parsed = Number(pathname.slice(1));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
}

function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379/1";
}

function redisKeyPrefix(): string {
  return process.env.REDIS_KEY_PREFIX ?? "";
}

export function getRedis(): Redis {
  if (client) return client;
  const keyPrefix = redisKeyPrefix();
  client = new Redis(redisUrl(), {
    ...(keyPrefix ? { keyPrefix } : {}),
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  return client;
}

export async function flushTestRedis(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "flushTestRedis called outside of NODE_ENV=test — refusing to flushdb.",
    );
  }

  const keyPrefix = redisKeyPrefix();
  if (keyPrefix) {
    const rawClient = new Redis(redisUrl(), {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    try {
      const testDbIndex = testRedisDbIndex();
      const selectedDb = await rawClient.select(testDbIndex);
      if (selectedDb !== "OK") {
        throw new Error(
          `flushTestRedis: failed to select Redis test DB ${String(testDbIndex)}.`,
        );
      }

      let cursor = "0";
      do {
        const [nextCursor, keys] = await rawClient.scan(
          cursor,
          "MATCH",
          `${keyPrefix}*`,
          "COUNT",
          100,
        );
        if (keys.length > 0) {
          await rawClient.del(...keys);
        }
        cursor = nextCursor;
      } while (cursor !== "0");
      return;
    } finally {
      await rawClient.quit();
    }
  }

  const client = getRedis();
  if (client.options.db !== 1) {
    throw new Error(
      `flushTestRedis: connected Redis DB is ${String(
        client.options.db,
      )}, expected 1. Refusing to flushdb. ` +
        `Set REDIS_URL=redis://localhost:6379/1.`,
    );
  }
  await client.flushdb();
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
