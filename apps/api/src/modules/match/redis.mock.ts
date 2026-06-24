// ============================================================
// Redis Mock Helper - Test fixture for RedisService
// Returns a minimal ioredis client shape that satisfies
// GameLoopService's lobby-countdown persistence usage.
// ============================================================

import { vi } from "vitest";

/**
 * Creates a mock ioredis client that supports the methods used by
 * GameLoopService for lobby countdown persistence (get, set, del, sadd,
 * srem, smembers) and pipeline `multi()` for atomic writes.
 */
export function createMockRedisClient() {
  return {
    multi: () => ({
      set: () => ({ sadd: () => ({ exec: () => Promise.resolve([]) }) }),
      del: () => ({ srem: () => ({ exec: () => Promise.resolve([]) }) }),
      sadd: () => ({ exec: () => Promise.resolve([]) }),
      srem: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    sadd: vi.fn().mockResolvedValue(0),
    srem: vi.fn().mockResolvedValue(0),
    smembers: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(0),
  };
}

/**
 * Creates a minimal RedisService stub exposing only the `getClient()`
 * surface used by GameLoopService. Tests can obtain a `vi.fn` for any
 * individual method via `mock.getClient().get.mockReturnValueOnce(...)`.
 *
 * The mock client is created once and reused across `getClient()` calls
 * so stubs applied to the returned client (e.g. `get.mockReturnValueOnce`)
 * persist between calls.
 */
export function createMockRedisService() {
  const client = createMockRedisClient();
  return {
    getClient: vi.fn(() => client),
  };
}
