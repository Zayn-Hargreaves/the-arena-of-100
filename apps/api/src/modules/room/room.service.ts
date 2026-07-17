// ============================================================
// Room Service - Room Management Logic
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  RoomStatus,
  MatchStatus,
  generateRoomCode,
  GAME_CONFIG,
  ErrorCode,
  RoomError,
  type JoinMode,
} from "@arena/shared";
import {
  RoomCacheStore,
  roomSnapshotKey,
  roomPlayerCountKey,
  roomPlayersKey,
  ROOM_CACHE_TTL_SECONDS,
} from "./room-cache.store";
import { clearPersistedCountdown } from "../match/game-loop.countdown-store";

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private readonly cache: RoomCacheStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.cache = new RoomCacheStore(this.redis);
  }

  // Create room
  async createRoom(
    hostId: string,
    roomType: "PUBLIC" | "PRIVATE",
    maxPlayers?: number,
    timeLimit?: number,
    category?: string,
  ) {
    // M2 fix: defence-in-depth cap on maxPlayers. The C2 fix
    // already caps it at the WebSocket validation layer (Zod
    // schema in @arena/shared), but the service is also called
    // from other paths in the future (admin tools, REST
    // controllers) and we never want a single room to claim a
    // 100k-player broadcast budget. Clamp here so the persisted
    // value is always within bounds.
    const playersInput =
      typeof maxPlayers === "number" && !Number.isNaN(maxPlayers)
        ? maxPlayers
        : GAME_CONFIG.MAX_PLAYERS;
    const safeMaxPlayers = Math.min(
      Math.max(2, Math.floor(playersInput)),
      GAME_CONFIG.MAX_PLAYERS,
    );

    const code = generateRoomCode();
    const room = await this.prisma.room.create({
      data: {
        code,
        type: roomType,
        status: RoomStatus.WAITING,
        hostId,
        maxPlayers: safeMaxPlayers,
        timeLimit: timeLimit ?? 15,
        category: category ?? "ALL",
      },
    });

    // Add host to room players
    await this.prisma.roomPlayer.create({
      data: {
        roomId: room.id,
        userId: hostId,
      },
    });

    // Cache room in Redis
    await this.cache.setSnapshot(room, 1);

    // Initialize the atomic player-count counter so concurrent joins/leaves
    // don't read a missing key.
    await this.redis.set(
      roomPlayerCountKey(room.id),
      "1",
      ROOM_CACHE_TTL_SECONDS,
    );

    // Add to player set
    await this.redis.sadd(roomPlayersKey(room.id), hostId);

    this.logger.log(`Room created: ${code} by host ${hostId}`);
    return room;
  }

  // Join room by code.
  //
  // Behaviour matrix (drop-in spectating baseline):
  //
  //   room.status      | user already in players? | outcome
  //   ------------------+--------------------------+--------------------
  //   WAITING          | no                       | join as PLAYER
  //   WAITING          | yes                      | no-op rejoin PLAYER
  //   COUNTDOWN/STARTING| *                       | reject ROOM_ALREADY_STARTED
  //   IN_GAME/FINISHED | yes (reconnect)          | rejoin as PLAYER
  //   IN_GAME/FINISHED | no                       | join as SPECTATOR (no DB write)
  //
  // The user-record check runs BEFORE the status check so that an
  // in-match player who disconnects and rejoins the room code keeps
  // their PLAYER role even if the room has progressed past WAITING.
  async joinRoom(roomCode: string, userId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) {
      throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
    }

    const isExistingPlayer = room.players.some((p) => p.userId === userId);

    // 1. Reconnect / no-op rejoin path — works in any status, since the
    //    user already has a RoomPlayer row.
    if (isExistingPlayer) {
      this.logger.log(
        `Player ${userId} (re)joined room ${roomCode} (status=${room.status})`,
      );
      const updatedRoom = await this.getRoom(room.id);
      return {
        ...updatedRoom,
        joined: false,
        joinedAs: "PLAYER" as JoinMode,
      };
    }

    // 2. WAITING — normal player join. Enforce maxPlayers atomically.
    //
    // The capacity check and the roomPlayer.create are wrapped in a
    // single Prisma transaction that begins with `SELECT ... FOR
    // UPDATE` on the parent Room row. Under PostgreSQL's default
    // READ COMMITTED isolation, a plain SELECT does NOT acquire any
    // row lock, so two concurrent join transactions could each read
    // `players.length = maxPlayers - 1`, both pass the capacity
    // check, and both insert — overshooting maxPlayers. The explicit
    // FOR UPDATE holds the row lock until commit/rollback, so the
    // second concurrent transaction blocks here, then re-evaluates
    // the count against the freshly-committed row.
    //
    // Additionally, the `isExistingPlayer` check is repeated INSIDE
    // the transaction. Two near-simultaneous requests for the same
    // *new* user (e.g. double-click / reconnect race) both see
    // `isExistingPlayer = false` from the outer pre-transaction
    // read. The FOR UPDATE lock serialises them, but the second
    // transaction would otherwise try to insert a duplicate
    // RoomPlayer and trip `@@unique([roomId, userId])` (Prisma
    // P2002) — which surfaces as INTERNAL_ERROR. Re-checking under
    // the lock turns the second insert into a no-op rejoin (same
    // outcome as the early-return path for an existing player).
    if (room.status === RoomStatus.WAITING) {
      let didCreate = false;
      await this.prisma.$transaction(async (tx) => {
        // Acquire a row-level lock on the Room. Tagged-template
        // parameter binding escapes the cuid safely; we never
        // interpolate user input.
        const lockedRoom = await tx.$queryRaw<
          Array<{ id: string; maxPlayers: number }>
        >`
          SELECT id, "maxPlayers"
          FROM "rooms"
          WHERE id = ${room.id}
          FOR UPDATE
        `;
        if (lockedRoom.length === 0) {
          // Room was deleted between the outer read and the
          // in-transaction lock acquisition. Treat as not-found so
          // the caller gets a typed error.
          throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
        }
        const maxPlayers = lockedRoom[0].maxPlayers;

        // Re-check membership under the row lock. Handles the
        // double-join race: a concurrent transaction may have
        // inserted the same (roomId, userId) between our outer
        // read and the lock acquisition.
        const existing = await tx.roomPlayer.findFirst({
          where: { roomId: room.id, userId },
          select: { id: true },
        });
        if (existing) {
          // No-op rejoin under the lock. Fall through with
          // didCreate = false; the caller will see `joined: false`
          // (same shape as the early-return reconnect path above).
          return;
        }

        // Count players under the row lock. Counting is cheaper
        // than re-fetching the include graph and is sufficient for
        // the capacity check.
        const currentPlayers = await tx.roomPlayer.count({
          where: { roomId: room.id },
        });
        if (currentPlayers >= maxPlayers) {
          throw new RoomError(ErrorCode.ROOM_FULL);
        }

        await tx.roomPlayer.create({
          data: {
            roomId: room.id,
            userId,
          },
        });
        didCreate = true;
      });

      // Only update Redis state if this transaction actually created
      // a RoomPlayer row. The no-op rejoin path (double-join race)
      // deliberately skips the sadd/incr/mirror to keep the cached
      // playerCount consistent with the authoritative DB.
      if (didCreate) {
        await this.redis.sadd(roomPlayersKey(room.id), userId);

        // Atomically bump the player-count counter. Safe under concurrent
        // joins, and ensures that if the key is recreated due to eviction or
        // expiry, a proper TTL is set to prevent key leakage.
        const newCount = await this.cache.incrementPlayerCount(room.id);

        // incrementPlayerCount returns NaN (best-effort) when Redis is
        // unavailable — skip mirroring a NaN into the cached snapshot.
        if (!Number.isNaN(newCount)) {
          await this.cache.syncPlayerCount(room.id, newCount);
        }

        this.logger.log(`Player ${userId} joined room ${roomCode}`);
      } else {
        this.logger.log(
          `Player ${userId} no-op rejoin room ${roomCode} (concurrent insert won the race)`,
        );
      }

      const updatedRoom = await this.getRoom(room.id);
      return {
        ...updatedRoom,
        joined: didCreate,
        joinedAs: "PLAYER" as JoinMode,
      };
    }

    // 3. IN_GAME / FINISHED — drop-in spectator path. No DB write, no
    //    playerCount bump, no RoomPlayer row. The user just receives a
    //    read-only view of the match (or the result if FINISHED).
    if (
      room.status === RoomStatus.IN_GAME ||
      room.status === RoomStatus.FINISHED
    ) {
      this.logger.log(
        `Spectator ${userId} joined room ${roomCode} (status=${room.status})`,
      );
      const updatedRoom = await this.getRoom(room.id);
      return {
        ...updatedRoom,
        joined: false,
        joinedAs: "SPECTATOR" as JoinMode,
      };
    }

    // 4. COUNTDOWN / STARTING — the match is about to launch; spectators
    //    would arrive too late to see anything useful, so we reject with
    //    the same error a stale join attempt would have hit before this
    //    PR.
    throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
  }

  // Leave room
  async leaveRoom(roomId: string, userId: string) {
    const result = await this.prisma.roomPlayer.deleteMany({
      where: { roomId, userId },
    });

    await this.redis.srem(roomPlayersKey(roomId), userId);

    // Clear the per-(room,user) presence key immediately so the sweeper does
    // not see this user as present in a room they have just left.
    try {
      await this.clearPresence(roomId, userId);
    } catch (error) {
      this.logger.warn(
        `Failed to clear presence for user ${userId} in room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Atomically decrement the player-count counter (clamped at 0) and
    // mirror the new value into the cached room JSON. The counter is the
    // source of truth; the JSON cache is updated best-effort from it.
    if (result.count > 0) {
      const newCount = await this.cache.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      // decrementPlayerCountClamped returns NaN (best-effort) when Redis
      // failed — skip mirroring a NaN into the cached snapshot.
      if (!Number.isNaN(newCount)) {
        await this.cache.syncPlayerCount(roomId, newCount);
      }
    }

    this.logger.log(`Player ${userId} left room ${roomId}`);

    return this.getRoom(roomId);
  }

  // Get room details
  async getRoom(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!room) {
      throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
    }

    return room;
  }

  // Get room by code
  async getRoomByCode(code: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!room) {
      throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
    }

    return room;
  }

  // List public rooms
  async listPublicRooms() {
    return this.prisma.room.findMany({
      where: {
        type: "PUBLIC",
        status: RoomStatus.WAITING,
      },
      include: {
        _count: { select: { players: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  // Update room status
  async updateRoomStatus(
    roomId: string,
    status: RoomStatus,
    currentMatchId?: string | null,
    options?: {
      expectedStatus?: RoomStatus;
      expectedCurrentMatchId?: string | null;
    },
  ) {
    if (options) {
      const room = await this.prisma.$transaction(async (tx) => {
        const updateResult = await tx.room.updateMany({
          where: {
            id: roomId,
            ...(options.expectedStatus !== undefined
              ? { status: options.expectedStatus }
              : {}),
            ...(options.expectedCurrentMatchId !== undefined
              ? { currentMatchId: options.expectedCurrentMatchId }
              : {}),
          },
          data: {
            status,
            ...(currentMatchId !== undefined ? { currentMatchId } : {}),
          },
        });

        if (updateResult.count === 0) {
          return null;
        }

        return tx.room.findUnique({
          where: { id: roomId },
          include: { players: true },
        });
      });

      if (!room) return null;
      await this.cache.syncRoomState(room);
      return room;
    }

    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: {
        status,
        ...(currentMatchId !== undefined ? { currentMatchId } : {}),
      },
      include: { players: true },
    });

    await this.cache.syncRoomState(room);
    return room;
  }

  // Get room players from Redis
  async getRoomPlayerIds(roomId: string): Promise<string[]> {
    return this.redis.smembers(roomPlayersKey(roomId));
  }

  // Find active rooms for a user
  async getUserActiveRooms(userId: string) {
    return this.prisma.roomPlayer.findMany({
      where: {
        userId,
        room: {
          status: {
            not: RoomStatus.FINISHED,
          },
        },
      },
      include: {
        room: {
          include: {
            players: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  // ============================================================
  // Presence & Stale Player Management
  // ============================================================

  async updatePresence(roomId: string, userId: string) {
    await this.redis.set(`room:presence:${roomId}:${userId}`, "1", 20);
  }

  async clearPresence(roomId: string, userId: string) {
    await this.redis.del(`room:presence:${roomId}:${userId}`);
  }

  async checkPresence(roomId: string, userId: string): Promise<boolean> {
    return this.redis.exists(`room:presence:${roomId}:${userId}`);
  }

  async getActiveRooms() {
    return this.prisma.room.findMany({
      where: {
        status: {
          in: [
            RoomStatus.WAITING,
            RoomStatus.COUNTDOWN,
            RoomStatus.STARTING,
            RoomStatus.IN_GAME,
            RoomStatus.FINISHED,
          ],
        },
      },
      include: {
        players: true,
      },
    });
  }

  async disbandRoom(roomId: string): Promise<{ safetyNetMatchIds: string[] }> {
    // Snapshot the player set before it's deleted below so the presence
    // keys for each player can be cleared too — otherwise they only
    // expire on their own 20s TTL, leaving a stale presence read window.
    const userIds = await this.redis.smembers(roomPlayersKey(roomId));

    // Match (and its cascading MatchPlayer/MatchRound/Answer/EventLog rows)
    // has no cascade-delete relation to Room, and deleting them here would
    // erase a played match's history and ranking data. A room that has
    // already hosted a match is kept around (its RoomPlayer rows are still
    // cleared so it stops showing up as occupied) instead of being
    // hard-deleted; only a room with no match history is fully removed.
    //
    // matchCount + delete-vs-finish run under a single Room FOR UPDATE
    // lock so a concurrent match create cannot race past a no-history
    // delete (or leave an IN_GAME shell after membership wipe).
    const safetyNetMatchIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const lockedRoom = await tx.$queryRaw<Array<{ id: string }>>` 
        SELECT id
        FROM "rooms"
        WHERE id = ${roomId}
        FOR UPDATE
      `;
      if (lockedRoom.length === 0) {
        return;
      }

      const matchCount = await tx.match.count({ where: { roomId } });

      if (matchCount > 0) {
        // Safety net: any non-terminal Match for this room is forced to
        // FINISHED here. Callers that own the live loop (presence host-stale
        // / admin kill-switch) should terminate via the state machine first;
        // this update is idempotent when they already did.
        //
        // Capture the IDs of non-FINISHED matches under the row lock BEFORE
        // the bulk update — updateMany does not return modified rows, and
        // a subsequent read after commit would be a different snapshot.
        const nonFinishedMatches = await tx.match.findMany({
          where: { roomId, status: { not: MatchStatus.FINISHED } },
          select: { id: true },
        });
        const terminatedIds = nonFinishedMatches.map((m) => m.id);

        const terminated = await tx.match.updateMany({
          where: { roomId, status: { not: MatchStatus.FINISHED } },
          data: {
            status: MatchStatus.FINISHED,
            endedAt: new Date(),
          },
        });
        // Immutable audit trail for the safety-net path only when a row
        // actually transitioned (already-FINISHED matches stay a no-op).
        if (terminated.count > 0) {
          safetyNetMatchIds.push(...terminatedIds);
          await tx.eventLog.create({
            data: {
              roomId,
              eventType: "MATCH_FORCE_FINISHED",
              payload: {
                source: "DISBAND_SAFETY_NET",
                terminatedCount: terminated.count,
                matchIds: terminatedIds,
              },
            },
          });
        }
        await tx.room.update({
          where: { id: roomId },
          data: {
            status: RoomStatus.FINISHED,
            currentMatchId: null,
          },
        });
        await tx.roomPlayer.deleteMany({ where: { roomId } });
      } else {
        await tx.roomPlayer.deleteMany({ where: { roomId } });
        await tx.room.delete({ where: { id: roomId } });
      }
    });

    await Promise.all([
      this.redis.del(roomPlayersKey(roomId)),
      this.redis.del(roomSnapshotKey(roomId)),
      this.redis.del(roomPlayerCountKey(roomId)),
      ...userIds.map((userId) => this.clearPresence(roomId, userId)),
      // Mirrors the admin kill-switch's Redis cleanup so both teardown
      // paths leave no room:countdown:<id> key or room:countdowns
      // membership behind.
      clearPersistedCountdown(this.redis.getClient(), roomId),
    ]);

    return { safetyNetMatchIds };
  }

  async removePlayer(roomId: string, userId: string) {
    const result = await this.prisma.roomPlayer.deleteMany({
      where: { roomId, userId },
    });
    await this.redis.srem(roomPlayersKey(roomId), userId);
    await this.clearPresence(roomId, userId);

    // Atomically decrement (clamped at 0) and mirror the new value into
    // the cached room JSON. The Lua-backed counter is the source of truth,
    // so concurrent leave/remove paths don't lose updates.
    if (result.count > 0) {
      const newCount = await this.cache.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      // decrementPlayerCountClamped returns NaN (best-effort) when Redis
      // failed — skip mirroring a NaN into the cached snapshot.
      if (!Number.isNaN(newCount)) {
        await this.cache.syncPlayerCount(roomId, newCount);
      }
    }
  }

  async removePlayerBatch(roomId: string, userIds: string[]) {
    if (userIds.length === 0) return;

    const result = await this.prisma.roomPlayer.deleteMany({
      where: {
        roomId,
        userId: { in: userIds },
      },
    });

    const presenceKeys = userIds.map(
      (userId) => `room:presence:${roomId}:${userId}`,
    );
    await Promise.all([
      this.redis.srem(roomPlayersKey(roomId), ...userIds),
      ...presenceKeys.map((key) => this.redis.del(key)),
    ]);

    // Atomic clamped decrement for the batch, then mirror the new value
    // into the cached room JSON. See removePlayer above.
    if (result.count > 0) {
      const newCount = await this.cache.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      // decrementPlayerCountClamped returns NaN (best-effort) when Redis
      // failed — skip mirroring a NaN into the cached snapshot.
      if (!Number.isNaN(newCount)) {
        await this.cache.syncPlayerCount(roomId, newCount);
      }
    }
  }
}
