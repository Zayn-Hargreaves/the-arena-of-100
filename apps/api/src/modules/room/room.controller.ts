// ============================================================
// Room Controller - REST Endpoints
// ============================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { RoomService } from "./room.service";
import { CreateRoomDto, createRoomSchema } from "./dto/create-room.dto";
import { JoinRoomDto, joinRoomSchema } from "./dto/join-room.dto";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { TokenPayload } from "../auth/auth.service";
import { Public } from "../../common/decorators/public.decorator";

export interface AuthenticatedRequest extends FastifyRequest {
  user: TokenPayload;
}

@ApiTags("Rooms")
@Controller("rooms")
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  @ApiOperation({ summary: "Create a new game room" })
  @ApiResponse({ status: 201, description: "Room created successfully" })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async create(
    @Body(new ZodValidationPipe(createRoomSchema))
    createRoomDto: CreateRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user.userId;
    return this.roomService.createRoom(
      userId,
      createRoomDto.roomType,
      createRoomDto.maxPlayers,
      createRoomDto.timeLimit,
      createRoomDto.category,
    );
  }

  @Post("join")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Join a game room by its code" })
  @ApiResponse({ status: 200, description: "Joined room successfully" })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async join(
    @Body(new ZodValidationPipe(joinRoomSchema))
    joinRoomDto: JoinRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user.userId;
    return this.roomService.joinRoom(joinRoomDto.roomCode, userId);
  }

  @Post(":roomId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Leave a game room" })
  @ApiResponse({ status: 204, description: "Left room successfully" })
  async leave(
    @Param("roomId") roomId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user.userId;
    await this.roomService.leaveRoom(roomId, userId);
  }

  @Get("public")
  @Public()
  @ApiOperation({ summary: "Get all public game rooms" })
  @ApiResponse({ status: 200, description: "Return public rooms list" })
  async listPublic() {
    return this.roomService.listPublicRooms();
  }

  @Get(":roomId")
  @Public()
  @ApiOperation({ summary: "Get room details by ID" })
  @ApiResponse({ status: 200, description: "Return room details" })
  @ApiResponse({ status: 404, description: "Room not found" })
  async getRoom(@Param("roomId") roomId: string) {
    return this.roomService.getRoom(roomId);
  }

  @Get("code/:code")
  @Public()
  @ApiOperation({ summary: "Get room details by room code" })
  @ApiResponse({ status: 200, description: "Return room details" })
  @ApiResponse({ status: 404, description: "Room not found" })
  async getByCode(@Param("code") code: string) {
    return this.roomService.getRoomByCode(code);
  }
}
