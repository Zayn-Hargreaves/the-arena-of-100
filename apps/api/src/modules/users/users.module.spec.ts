import { Test } from "@nestjs/testing";
import { describe, it, expect } from "vitest";
import { UsersModule } from "./users.module";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PrismaService } from "../prisma/prisma.service";

import { PrismaModule } from "../prisma/prisma.module";

describe("UsersModule", () => {
  it("compiles and exposes UsersService + UsersController", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, UsersModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get<UsersService>(UsersService)).toBeDefined();
    expect(moduleRef.get<UsersController>(UsersController)).toBeDefined();
  });
});
