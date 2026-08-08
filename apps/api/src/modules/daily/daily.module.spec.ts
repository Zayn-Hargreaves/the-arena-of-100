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
  it("compiles and exposes DailyService + DailyController", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, DailyModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({ verifyToken: () => null })
      .compile();

    expect(moduleRef.get<DailyService>(DailyService)).toBeDefined();
    expect(moduleRef.get<DailyController>(DailyController)).toBeDefined();
  });
});
