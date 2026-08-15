// ============================================================
// Matchmaking Module
// ============================================================

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { RoomModule } from "../room/room.module";
import { MatchModule } from "../match/match.module";
import { MatchmakingQueueStore } from "./matchmaking-queue.store";
import { BotService } from "./bot.service";
import { MatchmakingService } from "./matchmaking.service";
import { MatchmakingWorkerService } from "./matchmaking-worker.service";
import { MatchmakingHandler } from "../../gateways/handlers/matchmaking.handler";

@Module({
  imports: [PrismaModule, RedisModule, RoomModule, MatchModule],
  providers: [
    MatchmakingQueueStore,
    BotService,
    MatchmakingService,
    MatchmakingWorkerService,
    MatchmakingHandler,
  ],
  exports: [
    MatchmakingService,
    MatchmakingWorkerService,
    MatchmakingHandler,
    BotService,
  ],
})
export class MatchmakingModule {}
