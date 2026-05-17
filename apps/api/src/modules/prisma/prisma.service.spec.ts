import { Test, TestingModule } from "@nestjs/testing";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaService } from "./prisma.service";

// Mock pg Pool
const mockEnd = vi.fn().mockResolvedValue(undefined);
vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => {
      return {
        end: mockEnd,
      };
    }),
  };
});

// Mock @prisma/adapter-pg PrismaPg
vi.mock("@prisma/adapter-pg", () => {
  return {
    PrismaPg: vi.fn().mockImplementation(() => {
      return {};
    }),
  };
});

// Mock @prisma/client PrismaClient
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      $connect = mockConnect;
      $disconnect = mockDisconnect;
    },
  };
});

describe("PrismaService", () => {
  let service: PrismaService;
  const originalEnv = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.DATABASE_URL = originalEnv;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("should throw an error if DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;

    expect(() => new PrismaService()).toThrow(
      "DATABASE_URL environment variable is missing!",
    );
  });

  it("should instantiate successfully if DATABASE_URL is present", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
    expect(service).toBeDefined();
  });

  it("should connect to database on onModuleInit", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
    await service.onModuleInit();

    expect(mockConnect).toHaveBeenCalled();
  });

  it("should disconnect and end pool on onModuleDestroy", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
    await service.onModuleDestroy();

    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });
});
