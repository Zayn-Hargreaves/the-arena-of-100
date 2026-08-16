// ============================================================
// Redis Core — key/value/set ops + connection lifecycle
// ============================================================
// Pure functions over the ioredis client. Owns the connection lifecycle
// (open, retry, error log, quit). The facade `RedisService` keeps the
// `client` field visible so existing tests can drive it directly.

import { Logger } from "@nestjs/common";
import Redis, { type RedisOptions } from "ioredis";
import type { ConfigService } from "@nestjs/config";

export interface ParsedRedisConfig {
  mode: "sentinel" | "standalone";
  url?: string;
  options: RedisOptions;
}

export function parseRedisConnectionOptions(
  configSource: ConfigService | Record<string, string | undefined>,
): ParsedRedisConfig {
  const getVal = (key: string, def?: string): string | undefined => {
    if (
      configSource &&
      typeof (configSource as ConfigService).get === "function"
    ) {
      const val = (configSource as ConfigService).get<string>(key);
      return val ?? def;
    }
    return (configSource as Record<string, string | undefined>)?.[key] ?? def;
  };

  const rawSentinels = getVal("REDIS_SENTINELS");
  const keyPrefix = getVal("REDIS_KEY_PREFIX");
  const password = getVal("REDIS_PASSWORD");
  const db = getVal("REDIS_DB");

  let dbNum: number | undefined;
  if (db !== undefined) {
    const trimmedDb = db.trim();
    const parsedNumber = Number(trimmedDb);
    if (
      !/^\d+$/.test(trimmedDb) ||
      !Number.isSafeInteger(parsedNumber) ||
      parsedNumber < 0
    ) {
      throw new Error(
        `Invalid REDIS_DB: "${db}". REDIS_DB must be a non-negative integer.`,
      );
    }
    dbNum = parsedNumber;
  }

  const commonOptions: RedisOptions = {
    ...(keyPrefix ? { keyPrefix } : {}),
    ...(password ? { password } : {}),
    ...(dbNum !== undefined ? { db: dbNum } : {}),
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      return Math.min(times * 50, 2000);
    },
    reconnectOnError(err: Error) {
      const targetError = "READONLY";
      if (err?.message && err.message.includes(targetError)) {
        return 2;
      }
      return false;
    },
  };

  if (rawSentinels !== undefined) {
    const items = rawSentinels
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (items.length === 0) {
      throw new Error("Invalid REDIS_SENTINELS: sentinel list cannot be empty");
    }

    const sentinels = items.map((item) => {
      const parts = item.split(":");
      if (parts.length > 2) {
        throw new Error(
          `Invalid sentinel configuration "${item}": too many components`,
        );
      }
      const host = parts[0]?.trim();
      const portStr = parts[1]?.trim();

      if (!host) {
        throw new Error(
          `Invalid sentinel configuration "${item}": host is required`,
        );
      }

      let port = 26379;
      if (portStr !== undefined) {
        if (!/^\d+$/.test(portStr)) {
          throw new Error(
            `Invalid sentinel port in "${item}": port must be a valid numeric value`,
          );
        }
        port = parseInt(portStr, 10);
        if (port < 1 || port > 65535) {
          throw new Error(
            `Invalid sentinel port in "${item}": port must be between 1 and 65535`,
          );
        }
      }

      return {
        host,
        port,
      };
    });

    if (sentinels.length === 0) {
      throw new Error("Invalid REDIS_SENTINELS: sentinel list cannot be empty");
    }

    const name = getVal("REDIS_SENTINEL_MASTER_NAME", "mymaster") || "mymaster";
    const sentinelPassword = getVal("REDIS_SENTINEL_PASSWORD");
    const rawRole = getVal("REDIS_SENTINEL_ROLE", "master") || "master";
    if (rawRole !== "master" && rawRole !== "slave") {
      throw new Error(
        `Invalid REDIS_SENTINEL_ROLE: "${rawRole}". Expected "master" or "slave"`,
      );
    }
    const role: "master" | "slave" = rawRole;

    return {
      mode: "sentinel",
      options: {
        ...commonOptions,
        sentinels,
        name,
        role,
        ...(sentinelPassword ? { sentinelPassword } : {}),
      },
    };
  }

  const redisUrl = getVal("REDIS_URL", "redis://localhost:6379")!;
  return {
    mode: "standalone",
    url: redisUrl,
    options: commonOptions,
  };
}

export interface RedisCoreRefs {
  client: { current: Redis | null };
  setClient: (c: Redis) => void;
}

export function createCoreRefs(initial: Redis): RedisCoreRefs {
  const ref: RedisCoreRefs = {
    client: { current: initial },
    setClient: (c) => {
      ref.client.current = c;
    },
  };
  return ref;
}

export function createRedisClient(
  configSource: ConfigService | Record<string, string | undefined>,
): Redis {
  const parsed = parseRedisConnectionOptions(configSource);
  if (parsed.mode === "sentinel") {
    return new Redis(parsed.options);
  }
  return new Redis(parsed.url!, parsed.options);
}

export async function quitRedisClient(
  client: Redis,
  logger: Logger,
): Promise<void> {
  await client.quit();
  logger.log("🔌 Redis disconnected");
}

// --- Key-value operations -----------------------------------------------

export async function get(client: Redis, key: string): Promise<string | null> {
  return client.get(key);
}

export async function mget(
  client: Redis,
  ...keys: string[]
): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  return client.mget(...keys);
}

export async function set(
  client: Redis,
  key: string,
  value: string,
  ttl?: number,
): Promise<void> {
  if (ttl) {
    await client.set(key, value, "EX", ttl);
  } else {
    await client.set(key, value);
  }
}

// Atomic "create-only" write. Uses Redis SET ... NX so the key is
// created iff it does NOT already exist. A concurrent writer that
// won the race is preserved; we never overwrite a fresher value.
// Returns true if the key was created, false if it already existed.
export async function setIfAbsent(
  client: Redis,
  key: string,
  value: string,
  ttl?: number,
): Promise<boolean> {
  const result = ttl
    ? await client.set(key, value, "EX", ttl, "NX")
    : await client.set(key, value, "NX");
  return result === "OK";
}

export async function setIfGenMatches(
  client: Redis,
  genKey: string,
  cacheKey: string,
  expectedGen: string,
  value: string,
  ttlSec: number,
): Promise<boolean> {
  const script = `
    local currentGen = redis.call('GET', KEYS[1]) or '0'
    if currentGen == ARGV[1] then
      redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
      return 1
    else
      return 0
    end
  `;
  const result = await client.eval(
    script,
    2,
    genKey,
    cacheKey,
    expectedGen,
    value,
    String(ttlSec),
  );
  return result === 1;
}

export async function del(client: Redis, key: string): Promise<void> {
  await client.del(key);
}

// JSON operations
export async function getJSON<T>(
  client: Redis,
  key: string,
): Promise<T | null> {
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

export async function setJSON(
  client: Redis,
  key: string,
  value: unknown,
  ttl?: number,
): Promise<void> {
  const json = JSON.stringify(value);
  await set(client, key, json, ttl);
}

// Set operations (for player lists, etc.)
export async function sadd(
  client: Redis,
  key: string,
  ...members: string[]
): Promise<number> {
  return client.sadd(key, ...members);
}

export async function srem(
  client: Redis,
  key: string,
  ...members: string[]
): Promise<number> {
  return client.srem(key, ...members);
}

export async function smembers(client: Redis, key: string): Promise<string[]> {
  return client.smembers(key);
}

export async function sismember(
  client: Redis,
  key: string,
  member: string,
): Promise<boolean> {
  const result = await client.sismember(key, member);
  return result === 1;
}

// Atomic counter
export async function incr(client: Redis, key: string): Promise<number> {
  return client.incr(key);
}

// Pub/Sub publisher
export async function publish(
  client: Redis,
  channel: string,
  message: string,
): Promise<number> {
  return client.publish(channel, message);
}

// Lua script execution
export async function luaEval(
  client: Redis,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  return client.eval(script, keys.length, ...keys, ...args);
}

// Check if a key exists
export async function exists(client: Redis, key: string): Promise<boolean> {
  const result = await client.exists(key);
  return result === 1;
}

// Server clock in epoch ms (from the TIME command). Used by the
// clock-skew measurement (B2c): each node publishes its offset from this
// common reference so synchronized nodes report ~0 skew regardless of when
// their heartbeats last fired.
export async function serverTimeMs(client: Redis): Promise<number> {
  const [sec, micros] = (await client.time()) as unknown as [string, string];
  return Number(sec) * 1000 + Math.floor(Number(micros) / 1000);
}
