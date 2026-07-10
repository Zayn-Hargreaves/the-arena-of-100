import { RedisService } from "../redis/redis.service";
import {
  RoomCacheStore,
  ROOM_CACHE_TTL_SECONDS,
  roomSnapshotKey,
  roomPlayerCountKey,
  roomPlayersKey,
} from "./room-cache.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRedis(): RedisService {
  return {
    setJSON: vi.fn(),
    getJSON: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setIfAbsent: vi.fn().mockResolvedValue(true),
    del: vi.fn(),
    eval: vi.fn().mockResolvedValue(0),
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn().mockResolvedValue([]),
    exists: vi.fn(),
    incr: vi.fn(),
    getClient: vi.fn(),
  } as unknown as RedisService;
}

const baseRoom = {
  id: "r1",
  code: "ABC123",
  status: "WAITING",
  hostId: "u1",
  currentMatchId: null as string | null,
  timeLimit: 30,
  category: "SCIENCE",
};

// ---------------------------------------------------------------------------
// Key builder exports
// ---------------------------------------------------------------------------

describe("key builders", () => {
  it("roomSnapshotKey returns the expected format", () => {
    expect(roomSnapshotKey("r1")).toBe("room:r1");
  });

  it("roomPlayerCountKey returns the expected format", () => {
    expect(roomPlayerCountKey("r1")).toBe("room:r1:playerCount");
  });

  it("roomPlayersKey returns the expected format", () => {
    expect(roomPlayersKey("r1")).toBe("room:r1:players");
  });
});

// ---------------------------------------------------------------------------
// RoomCacheStore
// ---------------------------------------------------------------------------

describe("RoomCacheStore", () => {
  let redis: RedisService;
  let store: RoomCacheStore;

  beforeEach(() => {
    redis = makeRedis();
    store = new RoomCacheStore(redis);
  });

  // -------------------------------------------------------------------------
  // setSnapshot
  // -------------------------------------------------------------------------

  describe("setSnapshot", () => {
    it("writes a JSON snapshot with the correct shape and TTL", async () => {
      await store.setSnapshot(baseRoom, 5);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        {
          id: "r1",
          code: "ABC123",
          status: "WAITING",
          hostId: "u1",
          playerCount: 5,
          currentMatchId: null,
          timeLimit: 30,
          category: "SCIENCE",
        },
        ROOM_CACHE_TTL_SECONDS,
      );
    });

    it("serialises a non-null currentMatchId", async () => {
      await store.setSnapshot({ ...baseRoom, currentMatchId: "m1" }, 2);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ currentMatchId: "m1" }),
        ROOM_CACHE_TTL_SECONDS,
      );
    });
  });

  // -------------------------------------------------------------------------
  // syncPlayerCount
  // -------------------------------------------------------------------------

  describe("syncPlayerCount", () => {
    it("calls the SET_PLAYER_COUNT_FIELD_SCRIPT via eval with the snapshot key and count", async () => {
      await store.syncPlayerCount("r1", 7);

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["7"],
      );
    });

    it("swallows Redis errors and logs them without throwing", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce(new Error("Redis down"));

      // Must not throw — best-effort operation
      await expect(store.syncPlayerCount("r1", 3)).resolves.toBeUndefined();
    });

    it("swallows non-Error rejection values without throwing", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce("string error");

      await expect(store.syncPlayerCount("r1", 3)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // syncRoomState
  // -------------------------------------------------------------------------

  describe("syncRoomState", () => {
    const roomWithPlayers = {
      ...baseRoom,
      players: [{ userId: "u1" }, { userId: "u2" }],
    };

    it("uses the live Redis counter when it already exists and is finite", async () => {
      vi.mocked(redis.get).mockResolvedValueOnce("8");

      await store.syncRoomState(roomWithPlayers);

      // playerCount should come from the live counter (8), not players.length (2)
      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 8 }),
        ROOM_CACHE_TTL_SECONDS,
      );
      // Counter key already exists — must NOT seed it again
      expect(redis.setIfAbsent).not.toHaveBeenCalled();
    });

    it("falls back to players.length and seeds the counter when the key is missing", async () => {
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      await store.syncRoomState(roomWithPlayers);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 2 }),
        ROOM_CACHE_TTL_SECONDS,
      );
      expect(redis.setIfAbsent).toHaveBeenCalledWith(
        "room:r1:playerCount",
        "2",
        ROOM_CACHE_TTL_SECONDS,
      );
    });

    it("falls back to players.length when the stored counter is not a finite number", async () => {
      vi.mocked(redis.get).mockResolvedValueOnce("NaN");

      await store.syncRoomState(roomWithPlayers);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 2 }),
        ROOM_CACHE_TTL_SECONDS,
      );
      // Key was present (not null) so we do NOT seed via setIfAbsent
      expect(redis.setIfAbsent).not.toHaveBeenCalled();
    });

    it("falls back to players.length when the stored counter is the string 'Infinity'", async () => {
      vi.mocked(redis.get).mockResolvedValueOnce("Infinity");

      await store.syncRoomState(roomWithPlayers);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 2 }),
        ROOM_CACHE_TTL_SECONDS,
      );
    });

    it("works correctly with an empty players array", async () => {
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      await store.syncRoomState({ ...baseRoom, players: [] });

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 0 }),
        ROOM_CACHE_TTL_SECONDS,
      );
      expect(redis.setIfAbsent).toHaveBeenCalledWith(
        "room:r1:playerCount",
        "0",
        ROOM_CACHE_TTL_SECONDS,
      );
    });
  });

  // -------------------------------------------------------------------------
  // decrementPlayerCountClamped
  // -------------------------------------------------------------------------

  describe("decrementPlayerCountClamped", () => {
    it("returns the Lua script result cast to a number", async () => {
      vi.mocked(redis.eval).mockResolvedValueOnce(4);

      const result = await store.decrementPlayerCountClamped("r1", 1);

      expect(result).toBe(4);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("KEEPTTL"),
        ["room:r1:playerCount"],
        ["1", String(ROOM_CACHE_TTL_SECONDS)],
      );
    });

    it("passes the correct `by` decrement argument", async () => {
      vi.mocked(redis.eval).mockResolvedValueOnce(3);

      await store.decrementPlayerCountClamped("r1", 2);

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ["room:r1:playerCount"],
        ["2", String(ROOM_CACHE_TTL_SECONDS)],
      );
    });

    it("returns NaN and does not throw when Redis errors (Error instance)", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce(new Error("timeout"));

      const result = await store.decrementPlayerCountClamped("r1", 1);

      expect(Number.isNaN(result)).toBe(true);
    });

    it("returns NaN and does not throw when Redis errors (non-Error rejection)", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce("connection refused");

      const result = await store.decrementPlayerCountClamped("r1", 1);

      expect(Number.isNaN(result)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // incrementPlayerCount
  // -------------------------------------------------------------------------

  describe("incrementPlayerCount", () => {
    it("returns the Lua script result cast to a number", async () => {
      vi.mocked(redis.eval).mockResolvedValueOnce(5);

      const result = await store.incrementPlayerCount("r1");

      expect(result).toBe(5);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("incr"),
        ["room:r1:playerCount"],
        [String(ROOM_CACHE_TTL_SECONDS)],
      );
    });

    it("passes ROOM_CACHE_TTL_SECONDS as the fallback TTL argument", async () => {
      vi.mocked(redis.eval).mockResolvedValueOnce(1);

      await store.incrementPlayerCount("r1");

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ["room:r1:playerCount"],
        [String(ROOM_CACHE_TTL_SECONDS)],
      );
    });

    it("returns NaN and does not throw when Redis errors (Error instance)", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce(
        new Error("Redis ECONNRESET"),
      );

      const result = await store.incrementPlayerCount("r1");

      expect(Number.isNaN(result)).toBe(true);
    });

    it("returns NaN and does not throw when Redis errors (non-Error rejection)", async () => {
      vi.mocked(redis.eval).mockRejectedValueOnce(42);

      const result = await store.incrementPlayerCount("r1");

      expect(Number.isNaN(result)).toBe(true);
    });
  });
});
