import { vi, describe, it, expect } from "vitest";
import type Redis from "ioredis";
import {
  clearPersistedCountdown,
  listPersistedCountdownRoomIds,
  LOBBY_COUNTDOWN_INDEX_KEY,
  LOBBY_COUNTDOWN_KEY_PREFIX,
  persistLobbyCountdown,
  readPersistedCountdownEnd,
  removeStaleCountdownIndexEntry,
} from "./game-loop.countdown-store";

interface ExecResultEntry {
  0: Error | null;
  1: unknown;
  length: 2;
}

function makeRedis(
  overrides: {
    execResult?: ExecResultEntry[] | null;
    get?: string | null;
    smembers?: string[];
  } = {},
): Redis {
  const execResult =
    overrides.execResult === undefined
      ? [
          [null, "OK"],
          [null, 1],
        ]
      : overrides.execResult;
  const multi = {
    set: vi.fn().mockReturnThis(),
    sadd: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    srem: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(execResult),
  };
  return {
    multi: vi.fn().mockReturnValue(multi),
    get: vi.fn().mockResolvedValue(overrides.get ?? null),
    smembers: vi.fn().mockResolvedValue(overrides.smembers ?? []),
    srem: vi.fn().mockResolvedValue(0),
  } as unknown as Redis;
}

describe("game-loop.countdown-store", () => {
  describe("persistLobbyCountdown", () => {
    it("writes the SET + SADD pair via a single multi() pipeline", async () => {
      const redis = makeRedis();
      await persistLobbyCountdown(redis, "r1", 1234567890);

      const m = (redis.multi as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(m.set).toHaveBeenCalledWith(
        `${LOBBY_COUNTDOWN_KEY_PREFIX}r1`,
        "1234567890",
        "EX",
        expect.any(Number),
      );
      expect(m.sadd).toHaveBeenCalledWith(LOBBY_COUNTDOWN_INDEX_KEY, "r1");
      expect(m.exec).toHaveBeenCalledTimes(1);
    });

    it("throws when exec() returns null (transaction discarded)", async () => {
      const redis = makeRedis({ execResult: null });
      await expect(persistLobbyCountdown(redis, "r1", 1)).rejects.toThrow(
        /redis multi\(\) transaction was discarded/,
      );
    });

    it("throws when a pipeline command reports an error", async () => {
      const redis = makeRedis({
        execResult: [
          [new Error("SET failed"), null],
          [null, 1],
        ],
      });
      await expect(persistLobbyCountdown(redis, "r1", 1)).rejects.toThrow(
        /SET failed/,
      );
    });
  });

  describe("clearPersistedCountdown", () => {
    it("writes the DEL + SREM pair via a single multi() pipeline", async () => {
      const redis = makeRedis();
      await clearPersistedCountdown(redis, "r1");

      const m = (redis.multi as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(m.del).toHaveBeenCalledWith(`${LOBBY_COUNTDOWN_KEY_PREFIX}r1`);
      expect(m.srem).toHaveBeenCalledWith(LOBBY_COUNTDOWN_INDEX_KEY, "r1");
      expect(m.exec).toHaveBeenCalledTimes(1);
    });

    it("throws when exec() returns null (transaction discarded)", async () => {
      const redis = makeRedis({ execResult: null });
      await expect(clearPersistedCountdown(redis, "r1")).rejects.toThrow(
        /redis multi\(\) transaction was discarded/,
      );
    });

    it("throws when a pipeline command reports an error", async () => {
      const redis = makeRedis({
        execResult: [
          [new Error("DEL failed"), null],
          [null, 0],
        ],
      });
      await expect(clearPersistedCountdown(redis, "r1")).rejects.toThrow(
        /DEL failed/,
      );
    });
  });

  describe("readPersistedCountdownEnd", () => {
    it("returns missing when the key is absent", async () => {
      const redis = makeRedis({ get: null });
      const result = await readPersistedCountdownEnd(redis, "r1");
      expect(result).toEqual({ kind: "missing" });
    });

    it("returns missing for empty strings and non-numeric payloads", async () => {
      const redis = makeRedis({ get: "not-a-number" });
      const result = await readPersistedCountdownEnd(redis, "r1");
      expect(result).toEqual({ kind: "missing" });
    });

    it("returns missing for strings with trailing garbage like '123abc'", async () => {
      const redis = makeRedis({ get: "123abc" });
      const result = await readPersistedCountdownEnd(redis, "r1");
      expect(result).toEqual({ kind: "missing" });
    });

    it("returns the parsed timestamp for fully numeric strings", async () => {
      const redis = makeRedis({ get: "1700000000000" });
      const result = await readPersistedCountdownEnd(redis, "r1");
      expect(result).toEqual({ kind: "present", value: 1700000000000 });
    });
  });

  describe("listPersistedCountdownRoomIds", () => {
    it("returns the smembers of the lobby-countdowns index set", async () => {
      const redis = makeRedis({ smembers: ["r1", "r2"] });
      const result = await listPersistedCountdownRoomIds(redis);
      expect(result).toEqual(["r1", "r2"]);
      expect(redis.smembers).toHaveBeenCalledWith(LOBBY_COUNTDOWN_INDEX_KEY);
    });
  });

  describe("removeStaleCountdownIndexEntry", () => {
    it("SREMs a single roomId from the lobby-countdowns index", async () => {
      const redis = makeRedis();
      await removeStaleCountdownIndexEntry(redis, "r1");
      expect(redis.srem).toHaveBeenCalledWith(LOBBY_COUNTDOWN_INDEX_KEY, "r1");
    });
  });
});
