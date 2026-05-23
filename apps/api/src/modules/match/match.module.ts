// ============================================================
// Match Module - Match Management
// ============================================================

import { Module } from "@nestjs/common";
import { MatchService } from "./match.service";
import { MatchController } from "./match.controller";
import { GameLoopService } from "./game-loop.service";
import { QuestionModule } from "../question/question.module";

@Module({
  imports: [QuestionModule],
  controllers: [MatchController],
  providers: [MatchService, GameLoopService],
  exports: [MatchService, GameLoopService],
})
export class MatchModule {}
