// ============================================================
// Integration: RoomService — Real database integration
//
// Validates that disbandRoom()'s safety-net path is fully
// transactional. Two cases are covered:
//
// 1. Successful path: disbandRoom() completes normally, the match
//    transitions to FINISHED, the room to FINISHED, and exactly
//    one EventLog row is written with the expected audit payload.
//
// 2. Rollback path: when room.update() throws AFTER a successful
//    match.updateMany() (+ eventLog.create), the entire transaction
//    (including the already-applied match update and audit row) must
//    be rolled back. The match must revert to ROUND_ACTIVE, the room
//    must stay WAITING, and no eventLog row may persist.
//
// Runs under the default vitest config (src/**/*.ts), NOT under
// vitest-e2e — this is an integration test (real DB + real Redis
// via the service layer), not a true HTTP E2E test. The shared
// setup-e2e helpers clone a per-file test database and namespace
// Redis keys, so the test stays isolated when run in parallel.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { RoomService } from "./room.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MatchStatus, RoomStatus } from "@arena/shared";
import { cleanupE2ETestEnv, prepareE2ETestEnv } from "../../../test/setup-e2e";

// __filename is always defined in CommonJS modules. pathToFileURL converts it
// to the file:// URL form that setup-e2e's fileURLToPath / stateByFile key
// expects — equivalent to import.meta.url in ESM, without TS1343 errors.
const currentFileUrl = pathToFileURL(__filename).href;

describe("RoomService (Real Database Integration)", () => {
  let realPrisma: PrismaService;
  let realRedis: RedisService;
  let envReady = false;

  beforeAll(async () => {
    try {
      await prepareE2ETestEnv(currentFileUrl);
      envReady = true;
    } catch (err) {
      const isCI = Boolean(process.env.CI);
      // In CI all infrastructure / connection failures are fatal: the
      // environment is guaranteed to be provisioned, so any error means
      // something is genuinely wrong and must fail the suite loudly.
      if (isCI) {
        throw err;
      }
      // Skip only when running locally and local test infra is missing
      // or misconfigured (no docker, wrong DATABASE_URL or REDIS_URL).
      // Migration, schema, and real connection failures in local runs
      // still fall through to `throw err` below so they are not silently
      // swallowed.
      const message = err instanceof Error ? err.message : String(err);
      const isMissingOrInvalidLocalTestInfra =
        /DATABASE_URL/i.test(message) ||
        /REDIS_URL/i.test(message) ||
        /E2E (template|tests require)/i.test(message);
      if (isMissingOrInvalidLocalTestInfra) {
        console.warn(`[room.service.integration-spec] Skipping — ${message}`);
        return;
      }
      throw err;
    }

    realPrisma = new PrismaService();
    await realPrisma.onModuleInit();

    const { ConfigService } = await import("@nestjs/config");
    const config = new ConfigService({
      REDIS_URL: process.env.REDIS_URL,
      REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
    });
    realRedis = new RedisService(config);
  });

  afterAll(async () => {
    if (realPrisma) {
      await realPrisma.onModuleDestroy();
    }
    if (realRedis) {
      await realRedis.onModuleDestroy();
    }
    if (envReady) {
      await cleanupE2ETestEnv(currentFileUrl);
    }
  });

  it("disbands a room with a non-FINISHED match: updates match+room to FINISHED and writes exactly one audit EventLog row", async () => {
    if (!envReady) {
      return;
    }
    // 1. Set up db state: user, room, and a non-FINISHED match
    //    (to trigger the safety-net path in disbandRoom).
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const host = await realPrisma.user.create({
      data: { username: `host_ok_${uniqueId}` },
    });

    const room = await realPrisma.room.create({
      data: {
        id: `room_ok_${uniqueId}`,
        code: `OK_${uniqueId}`.substring(0, 10).toUpperCase(),
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        hostId: host.id,
      },
    });

    const match = await realPrisma.match.create({
      data: {
        id: `match_ok_${uniqueId}`,
        roomId: room.id,
        status: MatchStatus.ROUND_ACTIVE,
      },
    });

    // 2. Call disbandRoom using the real service — no forced failure.
    //    Capture the return value: PresenceService consumes safetyNetMatchIds
    //    to decide which MATCH_FINISHED events to emit, so this is a
    //    first-class contract that must be asserted here.
    const service = new RoomService(realPrisma, realRedis);
    const { safetyNetMatchIds } = await service.disbandRoom(room.id);

    // 2a. Assert the return-value contract: the terminated match ID must be
    //     present so PresenceService emits MATCH_FINISHED with the real matchId.
    expect(safetyNetMatchIds).toHaveLength(1);
    expect(safetyNetMatchIds[0]).toBe(match.id);

    // 3. Assert the match was transitioned to FINISHED.
    const matchAfter = await realPrisma.match.findUnique({
      where: { id: match.id },
    });
    expect(matchAfter?.status).toBe(MatchStatus.FINISHED);
    expect(matchAfter?.endedAt).not.toBeNull();

    // 4. Assert the room was updated to FINISHED.
    const roomAfter = await realPrisma.room.findUnique({
      where: { id: room.id },
    });
    expect(roomAfter?.status).toBe(RoomStatus.FINISHED);
    expect(roomAfter?.currentMatchId).toBeNull();

    // 5. Assert exactly one EventLog row was written with the expected
    //    audit payload from the safety-net path.
    const logs = await realPrisma.eventLog.findMany({
      where: { roomId: room.id },
    });
    expect(logs).toHaveLength(1);
    const payload = logs[0]?.payload as Record<string, unknown>;
    expect(payload?.source).toBe("DISBAND_SAFETY_NET");
    expect(payload?.terminatedCount).toBe(1);
    expect(Array.isArray(payload?.matchIds)).toBe(true);
    expect((payload?.matchIds as string[])[0]).toBe(match.id);
  });

  it("rolls back a successful match.updateMany when room.update throws on the safety-net path", async () => {
    if (!envReady) {
      return;
    }
    // 1. Set up db state: user, room, and a non-FINISHED match
    //    (to trigger the safety-net path in disbandRoom).
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const host = await realPrisma.user.create({
      data: { username: `host_${uniqueId}` },
    });

    const room = await realPrisma.room.create({
      data: {
        id: `room_${uniqueId}`,
        code: `CD_${uniqueId}`.substring(0, 10).toUpperCase(),
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        hostId: host.id,
      },
    });

    const match = await realPrisma.match.create({
      data: {
        id: `match_${uniqueId}`,
        roomId: room.id,
        status: MatchStatus.ROUND_ACTIVE,
      },
    });

    // 2. Let match.updateMany (+ eventLog.create) succeed, then fail on
    //    room.update — the next real transactional write after the
    //    safety-net terminalization. Proves rollback undoes prior writes.
    const failingPrisma = realPrisma.$extends({
      query: {
        room: {
          async update() {
            throw new Error("forced room.update failure");
          },
        },
      },
    });

    const integrationService = new RoomService(failingPrisma as any, realRedis);

    // 3. Execute disbandRoom on the integrationService and expect it to throw
    //    (from the forced room.update failure inside the transaction).
    await expect(integrationService.disbandRoom(room.id)).rejects.toThrow(
      "forced room.update failure",
    );

    // 4. Assert that NO EventLog row persists for this room
    const logCount = await realPrisma.eventLog.count({
      where: { roomId: room.id },
    });
    expect(logCount).toBe(0);

    // 5. Assert that the match status was ROLLED BACK to ROUND_ACTIVE.
    //    This is the critical proof of transaction atomicity: the
    //    updateMany DID write FINISHED + endedAt to the row, but because
    //    a later step in the same $transaction threw, the whole
    //    transaction — including that update — must have been reverted.
    const matchAfter = await realPrisma.match.findUnique({
      where: { id: match.id },
    });
    expect(matchAfter?.status).toBe(MatchStatus.ROUND_ACTIVE);
    expect(matchAfter?.endedAt).toBeNull();

    // 6. Assert that the room status was NOT updated to FINISHED
    const roomAfter = await realPrisma.room.findUnique({
      where: { id: room.id },
    });
    expect(roomAfter?.status).toBe(RoomStatus.WAITING);
  });
});
