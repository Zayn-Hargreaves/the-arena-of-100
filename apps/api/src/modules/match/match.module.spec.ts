import { Test } from "@nestjs/testing";
import { MatchModule } from "./match.module";
import { MatchService } from "./match.service";
import { GameLoopService } from "./game-loop.service";
import { QuestionService } from "../question/question.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { ConfigService } from "@nestjs/config";
import { describe, it, expect } from "vitest";

describe("MatchModule", () => {
  it("should compile the module and resolve providers successfully", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MatchModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({})
      .overrideProvider(QuestionService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue({ get: () => "test-value" })
      .compile();

    const matchService = moduleRef.get<MatchService>(MatchService);
    const gameLoopService = moduleRef.get<GameLoopService>(GameLoopService);

    expect(matchService).toBeDefined();
    expect(gameLoopService).toBeDefined();
  });
});
