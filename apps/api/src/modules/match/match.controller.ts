// ============================================================
// Match Controller - REST Endpoints
// ============================================================

import { Controller, Get, Post, Param } from '@nestjs/common';
import { MatchService } from './match.service';

@Controller('matches')
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Post('room/:roomId')
  async createFromRoom(@Param('roomId') roomId: string) {
    return this.matchService.createMatch(roomId);
  }

  @Get(':matchId')
  async getMatch(@Param('matchId') matchId: string) {
    return this.matchService.getMatch(matchId);
  }
}