// ============================================================
// Redis helpers for e2e tests.
//
// The leaderboard endpoint caches results for 60s. To make
// cache-hit/miss tests deterministic, expose a `flushDb` helper
// that wipes only the dedicated test Redis DB (index 1).
// ============================================================

import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const url = process.env.REDIS_URL ?? "redis://localhost:6379/1";
  client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
  return client;
}

export async function flushTestRedis(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "flushTestRedis called outside of NODE_ENV=test — refusing to flushdb.",
    );
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
