// ============================================================
// Arena of 100 - Root Application Module
// Modular Monolith Architecture
// ============================================================

import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { HealthModule } from "./modules/health/health.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { ClusterModule } from "./modules/cluster/cluster.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RoomModule } from "./modules/room/room.module";
import { MatchModule } from "./modules/match/match.module";
import { QuestionModule } from "./modules/question/question.module";
import { AdminModule } from "./modules/admin/admin.module";
import { UsersModule } from "./modules/users/users.module";
import { RankingsModule } from "./modules/rankings/rankings.module";
import { DailyModule } from "./modules/daily/daily.module";
import { GameGateway } from "./gateways/game.gateway";
import { AuthHandler, RoomHandler, MatchHandler } from "./gateways/handlers";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "./modules/auth/guards/roles.guard";
import { CsrfGuard } from "./modules/auth/guards/csrf.guard";
import { ThrottlerGuard } from "@nestjs/throttler";
import { positiveIntEnv } from "./common/config/env";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),

    // Rate Limiting. Env-tunable because the throttler keys on client IP:
    // behind a load balancer every request arrives from the same upstream
    // address, so a load-test cluster (hundreds of VUs on one host IP)
    // needs a far higher ceiling than a public deployment. Defaults are
    // the production values — override only in trusted environments.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: positiveIntEnv(process.env.THROTTLE_TTL_MS, 60000),
          limit: positiveIntEnv(process.env.THROTTLE_LIMIT, 100),
        },
      ],
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    ClusterModule,

    // Feature Modules
    HealthModule,
    AuthModule,
    RoomModule,
    MatchModule,
    QuestionModule,
    AdminModule,
    UsersModule,
    RankingsModule,
    DailyModule,
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
      useClass: CsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
