// ============================================================
// Arena of 100 - Root Application Module
// Modular Monolith Architecture
// ============================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { RoomModule } from './modules/room/room.module';
import { MatchModule } from './modules/match/match.module';
import { GameGateway } from './gateways/game.gateway';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,

    // Feature Modules
    HealthModule,
    AuthModule,
    RoomModule,
    MatchModule,
  ],
  providers: [GameGateway],
})
export class AppModule {}