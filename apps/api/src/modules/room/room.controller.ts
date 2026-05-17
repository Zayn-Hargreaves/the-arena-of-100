// ============================================================
// Room Controller - REST Endpoints
// ============================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { RoomService } from "./room.service";
import { z } from "zod";

const createRoomSchema = z.object({
  roomType: z.enum(["PUBLIC", "PRIVATE"]),
  maxPlayers: z.number().min(2).max(100).optional(),
});

const joinRoomSchema = z.object({
  roomCode: z.string().length(6),
});

@Controller("rooms")
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  async create(@Body() body: unknown, @Query("userId") userId: string) {
    const { roomType, maxPlayers } = createRoomSchema.parse(body);
    return this.roomService.createRoom(userId, roomType, maxPlayers);
  }

  @Post("join")
  @HttpCode(HttpStatus.OK)
  async join(@Body() body: unknown, @Query("userId") userId: string) {
    const { roomCode } = joinRoomSchema.parse(body);
    return this.roomService.joinRoom(roomCode, userId);
  }

  @Post(":roomId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param("roomId") roomId: string,
    @Query("userId") userId: string,
  ) {
    await this.roomService.leaveRoom(roomId, userId);
  }

  @Get("public")
  async listPublic() {
    return this.roomService.listPublicRooms();
  }

  @Get(":roomId")
  async getRoom(@Param("roomId") roomId: string) {
    return this.roomService.getRoom(roomId);
  }

  @Get("code/:code")
  async getByCode(@Param("code") code: string) {
    return this.roomService.getRoomByCode(code);
  }
}
