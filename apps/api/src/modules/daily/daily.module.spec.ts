import { Test } from "@nestjs/testing";
import { describe, it, expect } from "vitest";
import { DailyModule } from "./daily.module";
import { DailyService } from "./daily.service";
import { DailyController } from "./daily.controller";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";

describe("DailyModule", () => {
  // PrismaModule and RedisModule are imported here even though both are
  // @Global(): the decorator makes their providers app-wide only once the
  // module is registered somewhere in the graph, it does not make them
  // ambient. In production AppModule does that registration; in an isolated
  // TestingModule it has to happen here, or DailyService cannot resolve
  // PrismaService. This mirrors RankingsModule's own spec.
  it("compiles and exposes DailyService + DailyController", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, DailyModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({
        verifyToken: () => null,
        signDailySession: () => "tok",
        verifyDailySession: () => {
          throw new Error("unused");
        },
      })
      .compile();

    expect(moduleRef.get<DailyService>(DailyService)).toBeDefined();
    expect(moduleRef.get<DailyController>(DailyController)).toBeDefined();
  });
});
