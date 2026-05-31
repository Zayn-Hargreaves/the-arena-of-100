// ============================================================
// Arena of 100 - Root Application Module
// Modular Monolith Architecture
// ============================================================

import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RoomModule } from "./modules/room/room.module";
import { MatchModule } from "./modules/match/match.module";
import { QuestionModule } from "./modules/question/question.module";
import { AdminModule } from "./modules/admin/admin.module";
import { GameGateway } from "./gateways/game.gateway";
import { AuthHandler, RoomHandler, MatchHandler } from "./gateways/handlers";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "./modules/auth/guards/roles.guard";

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
    AdminModule,
  ],
  providers: [
    GameGateway,
    AuthHandler,
    RoomHandler,
    MatchHandler,
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
