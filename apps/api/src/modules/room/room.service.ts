// ============================================================
// Room Service - Room Management Logic
// ============================================================

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  RoomStatus,
  generateRoomCode,
  GAME_CONFIG,
  ErrorCode,
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
  ) {
    const code = generateRoomCode();
    const room = await this.prisma.room.create({
      data: {
        code,
        type: roomType,
        status: RoomStatus.WAITING,
        hostId,
        maxPlayers: maxPlayers ?? GAME_CONFIG.MAX_PLAYERS,
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
      throw new NotFoundException(ErrorCode.ROOM_NOT_FOUND);
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new BadRequestException(ErrorCode.ROOM_ALREADY_STARTED);
    }

    if (room.players.length >= room.maxPlayers) {
      throw new BadRequestException(ErrorCode.ROOM_FULL);
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
    return room;
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
      throw new NotFoundException(ErrorCode.ROOM_NOT_FOUND);
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
      throw new NotFoundException(ErrorCode.ROOM_NOT_FOUND);
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
  async updateRoomStatus(roomId: string, status: RoomStatus) {
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: { status },
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
      },
      3600,
    );

    return room;
  }

  // Get room players from Redis
  async getRoomPlayerIds(roomId: string): Promise<string[]> {
    return this.redis.smembers(`room:${roomId}:players`);
  }
}
