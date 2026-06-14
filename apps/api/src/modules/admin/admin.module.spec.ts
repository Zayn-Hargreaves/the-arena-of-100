import { Test } from "@nestjs/testing";
import { AdminModule } from "./admin.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { QuestionService } from "../question/question.service";
import { AuthService } from "../auth/auth.service";
import { ConfigService } from "@nestjs/config";
import { describe, it, expect } from "vitest";

describe("AdminModule", () => {
  it("should compile the module and resolve AdminController & AdminService", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule],
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

    const adminController = moduleRef.get<AdminController>(AdminController);
    const adminService = moduleRef.get<AdminService>(AdminService);

    expect(adminController).toBeDefined();
    expect(adminService).toBeDefined();
  });
});
