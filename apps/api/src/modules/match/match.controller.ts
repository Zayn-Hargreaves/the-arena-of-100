// ============================================================
// Match Controller - REST Endpoints
// ============================================================

import { Controller, Get, Post, Param } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator";
import { MatchService } from "./match.service";

@Controller("matches")
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Post("room/:roomId")
  async createFromRoom(@Param("roomId") roomId: string) {
    return this.matchService.createMatch(roomId);
  }

  @Public()
  @Get(":matchId")
  async getMatch(@Param("matchId") matchId: string) {
    return this.matchService.getMatch(matchId);
  }
}
