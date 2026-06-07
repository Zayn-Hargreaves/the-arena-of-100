// ============================================================
// Match Module - Match Management
// ============================================================

import { Module } from "@nestjs/common";
import { MatchService } from "./match.service";
import { MatchController } from "./match.controller";
import { GameLoopService } from "./game-loop.service";
import { PresenceService } from "./presence.service";
import { QuestionModule } from "../question/question.module";
import { RoomModule } from "../room/room.module";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [QuestionModule, RoomModule, RedisModule],
  controllers: [MatchController],
  providers: [MatchService, GameLoopService, PresenceService],
  exports: [MatchService, GameLoopService, PresenceService],
})
export class MatchModule {}
