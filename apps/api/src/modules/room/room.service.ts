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
} from "@arena/shared";

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
    const code = generateRoomCode();
    const room = await this.prisma.room.create({
      data: {
        code,
        type: roomType,
        status: RoomStatus.WAITING,
        hostId,
        maxPlayers: maxPlayers ?? GAME_CONFIG.MAX_PLAYERS,
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

    // Add to player set
    await this.redis.sadd(`room:${room.id}:players`, hostId);

    this.logger.log(`Room created: ${code} by host ${hostId}`);
    return room;
  }

  // Join room by code
  async joinRoom(roomCode: string, userId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) {
      throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
    }

    if (room.players.length >= room.maxPlayers) {
      throw new RoomError(ErrorCode.ROOM_FULL);
    }

    // Check if already in room
    const isAlreadyInRoom = room.players.some((p) => p.userId === userId);
    if (!isAlreadyInRoom) {
      await this.prisma.roomPlayer.create({
        data: {
          roomId: room.id,
          userId,
        },
      });

      await this.redis.sadd(`room:${room.id}:players`, userId);

      // Update cache
      const cached = await this.redis.getJSON<{ playerCount: number }>(
        `room:${room.id}`,
      );
      if (cached) {
        cached.playerCount++;
        await this.redis.setJSON(`room:${room.id}`, cached, 3600);
      }
    }

    this.logger.log(`Player ${userId} joined room ${roomCode}`);

    const updatedRoom = await this.getRoom(room.id);
    return {
      ...updatedRoom,
      joined: !isAlreadyInRoom,
    };
  }

  // Leave room
  async leaveRoom(roomId: string, userId: string) {
    await this.prisma.roomPlayer.deleteMany({
      where: { roomId, userId },
    });

    await this.redis.srem(`room:${roomId}:players`, userId);

    // Update cache
    const cached = await this.redis.getJSON<{
      playerCount: number;
      hostId: string;
    }>(`room:${roomId}`);
    if (cached) {
      cached.playerCount--;
      await this.redis.setJSON(`room:${roomId}`, cached, 3600);
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

    const cached = await this.redis.getJSON<{ playerCount: number }>(
      `room:${roomId}`,
    );
    if (cached) {
      cached.playerCount = Math.max(0, cached.playerCount - result.count);
      await this.redis.setJSON(`room:${roomId}`, cached, 3600);
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

    const cached = await this.redis.getJSON<{ playerCount: number }>(
      `room:${roomId}`,
    );
    if (cached) {
      cached.playerCount = Math.max(0, cached.playerCount - result.count);
      await this.redis.setJSON(`room:${roomId}`, cached, 3600);
    }
  }
}
