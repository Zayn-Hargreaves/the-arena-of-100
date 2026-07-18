// ============================================================
// Match Module - Match Management
// ============================================================

import { Module } from "@nestjs/common";
import { MatchService } from "./match.service";
import { MatchController } from "./match.controller";
import { GameLoopService } from "./game-loop.service";
import { LobbyCountdownService } from "./lobby-countdown.service";
import { PresenceService } from "./presence.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { QuestionModule } from "../question/question.module";
import { RoomModule } from "../room/room.module";
import { RedisModule } from "../redis/redis.module";
import { ClusterModule } from "../cluster/cluster.module";

@Module({
  // ClusterModule is @Global, but import it explicitly so MatchOwnershipService's
  // ClusterService dependency resolves when MatchModule is compiled in isolation.
  imports: [QuestionModule, RoomModule, RedisModule, ClusterModule],
  controllers: [MatchController],
  providers: [
    MatchService,
    GameLoopService,
    LobbyCountdownService,
    PresenceService,
    MatchOwnershipService,
  ],
  exports: [
    MatchService,
    GameLoopService,
    LobbyCountdownService,
    PresenceService,
    MatchOwnershipService,
  ],
})
export class MatchModule {}
