import { GAME_CONFIG } from "@arena/shared";
import type Redis from "ioredis";

const COUNTDOWN_KEY_PREFIX = "room:countdown:";
const COUNTDOWN_INDEX_KEY = "room:countdowns";
// TTL long enough to cover a process restart + recovery window well
// beyond the countdown duration itself, so persisted room:countdown:*
// keys survive until onModuleInit() can restore them.
const COUNTDOWN_REDIS_TTL_SEC = Math.ceil(
  (GAME_CONFIG.COUNTDOWN_DURATION_MS * 10) / 1000,
);

export async function persistLobbyCountdown(
  redis: Redis,
  roomId: string,
  countdownEndsAt: number,
): Promise<void> {
  const results = await redis
    .multi()
    .set(
      `${COUNTDOWN_KEY_PREFIX}${roomId}`,
      countdownEndsAt.toString(),
      "EX",
      COUNTDOWN_REDIS_TTL_SEC,
    )
    .sadd(COUNTDOWN_INDEX_KEY, roomId)
    .exec();
  if (results === null) {
    throw new Error(
      "persistLobbyCountdown: redis multi() transaction was discarded",
    );
  }
  const firstError = results.find((entry) => entry[0] !== null)?.[0];
  if (firstError) {
    throw new Error(
      `persistLobbyCountdown: redis pipeline command failed: ${firstError.message}`,
    );
  }
}

export async function clearPersistedCountdown(
  redis: Redis,
  roomId: string,
): Promise<void> {
  const results = await redis
    .multi()
    .del(`${COUNTDOWN_KEY_PREFIX}${roomId}`)
    .srem(COUNTDOWN_INDEX_KEY, roomId)
    .exec();
  if (results === null) {
    throw new Error(
      "clearPersistedCountdown: redis multi() transaction was discarded",
    );
  }
  const firstError = results.find((entry) => entry[0] !== null)?.[0];
  if (firstError) {
    throw new Error(
      `clearPersistedCountdown: redis pipeline command failed: ${firstError.message}`,
    );
  }
}

export type ReadPersistedCountdownEndResult =
  | { kind: "missing" }
  | { kind: "present"; value: number };

export async function readPersistedCountdownEnd(
  redis: Redis,
  roomId: string,
): Promise<ReadPersistedCountdownEndResult> {
  const raw = await redis.get(`${COUNTDOWN_KEY_PREFIX}${roomId}`);
  if (raw === null) return { kind: "missing" };
  if (!/^\d+$/.test(raw)) return { kind: "missing" };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return { kind: "missing" };
  return { kind: "present", value: parsed };
}

export async function listPersistedCountdownRoomIds(
  redis: Redis,
): Promise<string[]> {
  return redis.smembers(COUNTDOWN_INDEX_KEY);
}

export async function removeStaleCountdownIndexEntry(
  redis: Redis,
  roomId: string,
): Promise<void> {
  await redis.srem(COUNTDOWN_INDEX_KEY, roomId);
}

export const COUNTDOWN_REDIS_TTL_SECONDS = COUNTDOWN_REDIS_TTL_SEC;
export const LOBBY_COUNTDOWN_KEY_PREFIX = COUNTDOWN_KEY_PREFIX;
export const LOBBY_COUNTDOWN_INDEX_KEY = COUNTDOWN_INDEX_KEY;
