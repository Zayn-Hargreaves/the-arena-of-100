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
  await getRedis().flushdb();
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
