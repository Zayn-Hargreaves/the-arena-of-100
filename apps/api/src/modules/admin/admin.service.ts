// ============================================================
// Admin Service — thin facade over the admin ops modules.
//
// The real work lives in ./ops/* as pure functions taking an explicit
// deps bag (prisma/redis/logger/collaborators). This service keeps the
// NestJS DI surface (constructor + public methods the controller calls)
// stable and delegates. `this.logger` is passed live on every call so
// log output routes through the same logger instance in every path.
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { RoomService } from "../room/room.service";
import { MatchService } from "../match/match.service";
import { GameLoopService } from "../match/game-loop.service";
import { getAuditEvents } from "./ops/admin-audit.ops";
import { syncQuestions } from "./ops/question-sync.ops";
import { resetSystem } from "./ops/system-reset.ops";
import {
  terminateRoom,
  type TerminateRoomResult,
} from "./ops/room-termination.ops";

export type { TerminateRoomResult };

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  syncQuestions(clearExisting: boolean, adminUserId: string) {
    return syncQuestions(
      { prisma: this.prisma, logger: this.logger },
      clearExisting,
      adminUserId,
    );
  }

  resetSystem(adminUserId: string) {
    return resetSystem(
      { prisma: this.prisma, redis: this.redis, logger: this.logger },
      adminUserId,
    );
  }

  terminateRoom(
    roomId: string,
    adminUserId: string,
    message?: string,
  ): Promise<TerminateRoomResult> {
    return terminateRoom(
      {
        prisma: this.prisma,
        redis: this.redis,
        roomService: this.roomService,
        matchService: this.matchService,
        gameLoopService: this.gameLoopService,
        logger: this.logger,
      },
      roomId,
      adminUserId,
      message,
    );
  }

  getAuditEvents(params: {
    limit: number;
    offset: number;
    roomId?: string;
    eventType?: string;
    adminUserId?: string;
  }): Promise<{ events: unknown[]; total: number }> {
    return getAuditEvents({ prisma: this.prisma, logger: this.logger }, params);
  }
}
