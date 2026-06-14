// ============================================================
// Admin Module - Registers Controller & Service
// ============================================================

import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { RoomModule } from "../room/room.module";
import { MatchModule } from "../match/match.module";

@Module({
  imports: [PrismaModule, RedisModule, RoomModule, MatchModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
