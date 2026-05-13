// ============================================================
// Arena of 100 - Root Application Module
// Modular Monolith Architecture
// ============================================================

import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RoomModule } from "./modules/room/room.module";
import { MatchModule } from "./modules/match/match.module";
import { QuestionModule } from "./modules/question/question.module";
import { GameGateway } from "./gateways/game.gateway";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,

    // Feature Modules
    HealthModule,
    AuthModule,
    RoomModule,
    MatchModule,
    QuestionModule,
  ],
  providers: [
    GameGateway,
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
