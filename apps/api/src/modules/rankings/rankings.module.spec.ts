import { Test } from "@nestjs/testing";
import { describe, it, expect } from "vitest";
import { RankingsModule } from "./rankings.module";
import { RankingsService } from "./rankings.service";
import { RankingsController } from "./rankings.controller";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";

describe("RankingsModule", () => {
  it("compiles and exposes RankingsService + RankingsController", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, RankingsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    expect(moduleRef.get<RankingsService>(RankingsService)).toBeDefined();
    expect(moduleRef.get<RankingsController>(RankingsController)).toBeDefined();
  });
});
