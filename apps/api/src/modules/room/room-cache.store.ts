// ============================================================
// RoomCacheStore — Redis-backed cached room snapshot + atomic
// player-count management. Extracted from RoomService as a plain
// collaborator (constructed as a field, not a DI provider) so the
// concurrency-sensitive Lua counter logic lives behind named methods
// and is independently unit-testable. All logic is verbatim from the
// former private RoomService methods.
// ============================================================

import { Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

// Shared key builders — the single source of truth for every room-related
// Redis key format (snapshot, player-count counter, players set).
// RoomService mirrors these exact formats for its own direct redis.*
// calls (sadd/incr/del/srem/smembers on the players set and counter), so
// both classes must go through these builders to avoid the formats
// drifting apart.
export function roomSnapshotKey(roomId: string): string {
  return `room:${roomId}`;
}

export function roomPlayerCountKey(roomId: string): string {
  return `room:${roomId}:playerCount`;
}

export function roomPlayersKey(roomId: string): string {
  return `room:${roomId}:players`;
}

// Atomic Lua script that decrements a player-count counter and clamps the
// result at 0. Returns the new (clamped) value. Avoids the read-modify-write
// race in concurrent join/leave/remove paths.
//
// KEEPTTL only preserves a TTL if the key still exists. If the counter key
// already expired, `get` returns nil and the subsequent `set ... KEEPTTL`
// creates a brand-new key with no TTL, leaking it forever. ARGV[2] carries
// a fallback TTL (seconds) to apply via EXPIRE in that case.
const DECR_PLAYER_COUNT_SCRIPT = `
local existed = redis.call('exists', KEYS[1]) == 1
local v = tonumber(redis.call('get', KEYS[1]) or '0')
v = v - tonumber(ARGV[1])
if v < 0 then v = 0 end
if existed then
  redis.call('set', KEYS[1], v, 'KEEPTTL')
else
  redis.call('set', KEYS[1], v)
  redis.call('expire', KEYS[1], tonumber(ARGV[2]))
end
return v
`;

// Atomic Lua script that increments a player-count counter.
// If the counter key has no TTL (meaning ttl == -1 or ttl < 0), sets the TTL
// to the fallback TTL (seconds) carried in ARGV[1].
// Returns the new incremented value.
const INCR_PLAYER_COUNT_SCRIPT = `
local v = redis.call('incr', KEYS[1])
local ttl = redis.call('ttl', KEYS[1])
if ttl < 0 then
  redis.call('expire', KEYS[1], tonumber(ARGV[1]))
end
return v
`;

// Atomic Lua script that updates only the playerCount field of the cached
// room JSON snapshot, preserving all other fields and the existing TTL.
// Returns nil if the key does not exist (caller should no-op). Avoids the
// read-modify-write race where a concurrent setSnapshot could be
// overwritten by a stale full-object setJSON.
const SET_PLAYER_COUNT_FIELD_SCRIPT = `
local val = redis.call('get', KEYS[1])
if not val then return nil end
local obj = cjson.decode(val)
obj['playerCount'] = tonumber(ARGV[1])
redis.call('set', KEYS[1], cjson.encode(obj), 'KEEPTTL')
return 1
`;

interface RoomSnapshotInput {
  id: string;
  code: string;
  status: string;
  hostId: string;
  currentMatchId: string | null;
  timeLimit: number;
  category: string;
}

// TTL applied to both the room snapshot and the player-count counter.
// Also used as the DECR script's fallback EXPIRE when the counter key
// had already expired before a decrement landed. Exported so RoomService
// can use the same value when it initializes the counter directly.
export const ROOM_CACHE_TTL_SECONDS = 3600;

export class RoomCacheStore {
  private readonly logger = new Logger(RoomCacheStore.name);

  constructor(private readonly redis: RedisService) {}

  async setSnapshot(room: RoomSnapshotInput, playerCount: number) {
    await this.redis.setJSON(
      roomSnapshotKey(room.id),
      {
        id: room.id,
        code: room.code,
        status: room.status,
        hostId: room.hostId,
        playerCount,
        currentMatchId: room.currentMatchId,
        timeLimit: room.timeLimit,
        category: room.category,
      },
      ROOM_CACHE_TTL_SECONDS,
    );
  }

  async syncPlayerCount(roomId: string, playerCount: number) {
    try {
      await this.redis.eval(
        SET_PLAYER_COUNT_FIELD_SCRIPT,
        [roomSnapshotKey(roomId)],
        [String(playerCount)],
      );
    } catch (error) {
      this.logger.error(
        `Failed to sync cached player count for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async syncRoomState(room: RoomSnapshotInput & { players: unknown[] }) {
    const counterKey = roomPlayerCountKey(room.id);
    const existingCounter = await this.redis.get(counterKey);
    const playerCount =
      existingCounter !== null && Number.isFinite(Number(existingCounter))
        ? Number(existingCounter)
        : room.players.length;

    await this.setSnapshot(room, playerCount);
    if (existingCounter === null) {
      await this.redis.setIfAbsent(
        counterKey,
        String(playerCount),
        ROOM_CACHE_TTL_SECONDS,
      );
    }
  }

  // Atomically decrements the room's player-count counter and clamps the
  // result at 0. Returns the new (clamped) value. Safe under concurrent
  // join/leave/remove because the decrement+clamp happens inside a single
  // Lua execution on Redis. Best-effort like syncPlayerCount: a Redis
  // failure here must not fail the leave/remove flow it's called from, so
  // errors are logged and NaN is returned as a sentinel — callers must
  // skip syncPlayerCount when they see NaN back.
  async decrementPlayerCountClamped(
    roomId: string,
    by: number,
  ): Promise<number> {
    try {
      const result = await this.redis.eval(
        DECR_PLAYER_COUNT_SCRIPT,
        [roomPlayerCountKey(roomId)],
        [String(by), String(ROOM_CACHE_TTL_SECONDS)],
      );
      return Number(result);
    } catch (error) {
      this.logger.error(
        `Failed to decrement cached player count for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return NaN;
    }
  }

  // Atomically increments the room's player-count counter. If the key has no
  // TTL (e.g. was recreated after eviction/expiry), sets the TTL to
  // ROOM_CACHE_TTL_SECONDS. Returns the new count. Safe under concurrent
  // join paths.
  async incrementPlayerCount(roomId: string): Promise<number> {
    try {
      const result = await this.redis.eval(
        INCR_PLAYER_COUNT_SCRIPT,
        [roomPlayerCountKey(roomId)],
        [String(ROOM_CACHE_TTL_SECONDS)],
      );
      return Number(result);
    } catch (error) {
      this.logger.error(
        `Failed to increment cached player count for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return NaN;
    }
  }
}
