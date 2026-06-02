import { Test, TestingModule } from "@nestjs/testing";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Pool } from "pg";
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

describe("PrismaService SSL configuration", () => {
  const ORIGINAL_ENV = { ...process.env };

  const setEnv = (overrides: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      process.env[key] = value;
    }
  };

  const buildService = (): PrismaService => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    return new PrismaService();
  };

  const getPoolSslConfig = () => {
    const calls = vi.mocked(Pool).mock.calls;
    const lastCall = calls[calls.length - 1];
    return lastCall?.[0]?.ssl;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("should not set ssl config when DATABASE_SSL is unset", () => {
    setEnv({
      DATABASE_SSL: undefined,
      PG_SSL_CA: undefined,
      PG_ALLOW_SELF_SIGNED: undefined,
    });
    buildService();
    expect(getPoolSslConfig()).toBeUndefined();
  });

  it("should not set ssl config when DATABASE_SSL is false", () => {
    setEnv({
      DATABASE_SSL: "false",
      PG_SSL_CA: undefined,
      PG_ALLOW_SELF_SIGNED: undefined,
    });
    buildService();
    expect(getPoolSslConfig()).toBeUndefined();
  });

  it("should use verified TLS with provided CA when DATABASE_SSL=true and PG_SSL_CA is set", () => {
    const fakeCa =
      "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
    setEnv({
      DATABASE_SSL: "true",
      PG_SSL_CA: fakeCa,
      PG_ALLOW_SELF_SIGNED: undefined,
    });
    buildService();
    expect(getPoolSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: fakeCa,
    });
  });

  it("should verify against system CAs by default when DATABASE_SSL=true and no CA is provided", () => {
    setEnv({
      DATABASE_SSL: "true",
      PG_SSL_CA: undefined,
      PG_ALLOW_SELF_SIGNED: undefined,
    });
    buildService();
    expect(getPoolSslConfig()).toEqual({ rejectUnauthorized: true });
    expect(getPoolSslConfig()).not.toHaveProperty("ca");
  });

  it("should disable verification only when DATABASE_SSL=true and PG_ALLOW_SELF_SIGNED=true (dev override)", () => {
    setEnv({
      DATABASE_SSL: "true",
      PG_SSL_CA: undefined,
      PG_ALLOW_SELF_SIGNED: "true",
    });
    buildService();
    expect(getPoolSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it("should ignore PG_ALLOW_SELF_SIGNED when DATABASE_SSL is disabled", () => {
    setEnv({
      DATABASE_SSL: "false",
      PG_SSL_CA: undefined,
      PG_ALLOW_SELF_SIGNED: "true",
    });
    buildService();
    expect(getPoolSslConfig()).toBeUndefined();
  });
});
