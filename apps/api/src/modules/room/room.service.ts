// ============================================================
// Room Service - Room Management Logic
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  RoomStatus,
  generateRoomCode,
  GAME_CONFIG,
  ErrorCode,
  RoomError,
  type JoinMode,
} from "@arena/shared";

// Atomic Lua script that decrements a player-count counter and clamps the
// result at 0. Returns the new (clamped) value. Avoids the read-modify-write
// race in concurrent join/leave/remove paths.
const DECR_PLAYER_COUNT_SCRIPT = `
local v = tonumber(redis.call('get', KEYS[1]) or '0')
v = v - tonumber(ARGV[1])
if v < 0 then v = 0 end
redis.call('set', KEYS[1], v, 'KEEPTTL')
return v
`;

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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
    await this.redis.setJSON(
      `room:${room.id}`,
      {
        id: room.id,
        code: room.code,
        status: room.status,
        hostId: room.hostId,
        playerCount: 1,
        currentMatchId: null,
        timeLimit: room.timeLimit,
        category: room.category,
      },
      3600,
    );

    // Initialize the atomic player-count counter so concurrent joins/leaves
    // don't read a missing key.
    await this.redis.set(`room:${room.id}:playerCount`, "1", 3600);

    // Add to player set
    await this.redis.sadd(`room:${room.id}:players`, hostId);

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
          FROM "Room"
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
        await this.redis.sadd(`room:${room.id}:players`, userId);

        // Atomically bump the player-count counter. INCR is safe for joins
        // (the count can only go up) and avoids the getJSON->modify->setJSON
        // race that loses concurrent increments.
        const newCount = await this.redis.incr(`room:${room.id}:playerCount`);

        // Best-effort: mirror the new count into the cached room JSON. The
        // counter is the source of truth; the JSON is for cheap reads.
        const cached = await this.redis.getJSON<{ playerCount: number }>(
          `room:${room.id}`,
        );
        if (cached) {
          cached.playerCount = newCount;
          await this.redis.setJSON(`room:${room.id}`, cached, 3600);
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

    await this.redis.srem(`room:${roomId}:players`, userId);

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
      const newCount = await this.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      const cached = await this.redis.getJSON<{
        playerCount: number;
        hostId: string;
      }>(`room:${roomId}`);
      if (cached) {
        cached.playerCount = newCount;
        await this.redis.setJSON(`room:${roomId}`, cached, 3600);
      }
    }

    this.logger.log(`Player ${userId} left room ${roomId}`);

    return this.getRoom(roomId);
  }

  // Atomically decrements the room's player-count counter and clamps the
  // result at 0. Returns the new (clamped) value. Safe under concurrent
  // join/leave/remove because the decrement+clamp happens inside a single
  // Lua execution on Redis.
  private async decrementPlayerCountClamped(
    roomId: string,
    by: number,
  ): Promise<number> {
    const result = await this.redis.eval(
      DECR_PLAYER_COUNT_SCRIPT,
      [`room:${roomId}:playerCount`],
      [String(by)],
    );
    return Number(result);
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
  ) {
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: {
        status,
        ...(currentMatchId !== undefined ? { currentMatchId } : {}),
      },
      include: { players: true },
    });

    await this.redis.setJSON(
      `room:${roomId}`,
      {
        id: room.id,
        code: room.code,
        status: room.status,
        hostId: room.hostId,
        playerCount: room.players.length,
        currentMatchId: room.currentMatchId,
        timeLimit: room.timeLimit,
        category: room.category,
      },
      3600,
    );

    // Re-sync the player-count counter from the DB so the atomic counter
    // stays consistent with the authoritative source when status changes.
    await this.redis.set(
      `room:${roomId}:playerCount`,
      String(room.players.length),
      3600,
    );

    return room;
  }

  // Get room players from Redis
  async getRoomPlayerIds(roomId: string): Promise<string[]> {
    return this.redis.smembers(`room:${roomId}:players`);
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
          in: [RoomStatus.WAITING, RoomStatus.COUNTDOWN, RoomStatus.STARTING],
        },
      },
      include: {
        players: true,
      },
    });
  }

  async disbandRoom(roomId: string) {
    await this.prisma.$transaction([
      this.prisma.roomPlayer.deleteMany({ where: { roomId } }),
      this.prisma.room.delete({ where: { id: roomId } }),
    ]);

    await Promise.all([
      this.redis.del(`room:${roomId}:players`),
      this.redis.del(`room:${roomId}`),
    ]);
  }

  async removePlayer(roomId: string, userId: string) {
    const result = await this.prisma.roomPlayer.deleteMany({
      where: { roomId, userId },
    });
    await this.redis.srem(`room:${roomId}:players`, userId);
    await this.clearPresence(roomId, userId);

    // Atomically decrement (clamped at 0) and mirror the new value into
    // the cached room JSON. The Lua-backed counter is the source of truth,
    // so concurrent leave/remove paths don't lose updates.
    if (result.count > 0) {
      const newCount = await this.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      const cached = await this.redis.getJSON<{ playerCount: number }>(
        `room:${roomId}`,
      );
      if (cached) {
        cached.playerCount = newCount;
        await this.redis.setJSON(`room:${roomId}`, cached, 3600);
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
      this.redis.srem(`room:${roomId}:players`, ...userIds),
      ...presenceKeys.map((key) => this.redis.del(key)),
    ]);

    // Atomic clamped decrement for the batch, then mirror the new value
    // into the cached room JSON. See removePlayer above.
    if (result.count > 0) {
      const newCount = await this.decrementPlayerCountClamped(
        roomId,
        result.count,
      );
      const cached = await this.redis.getJSON<{ playerCount: number }>(
        `room:${roomId}`,
      );
      if (cached) {
        cached.playerCount = newCount;
        await this.redis.setJSON(`room:${roomId}`, cached, 3600);
      }
    }
  }
}
