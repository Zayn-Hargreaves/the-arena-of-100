import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  Controller,
  Get,
  Inject,
  Module,
  Query,
  UseGuards,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  getAuditEventsSchema,
  GetAuditEventsDto,
} from "./get-audit-events.dto";

describe("getAuditEventsSchema", () => {
  it("accepts empty input and applies defaults", () => {
    const result = getAuditEventsSchema.parse({});
    expect(result).toEqual({ limit: 50, offset: 0 });
  });

  it("accepts valid limit and offset", () => {
    const result = getAuditEventsSchema.parse({ limit: 25, offset: 10 });
    expect(result).toEqual({ limit: 25, offset: 10 });
  });

  it("accepts limit of exactly 1 and 100 (boundary values)", () => {
    expect(getAuditEventsSchema.parse({ limit: 1 }).limit).toBe(1);
    expect(getAuditEventsSchema.parse({ limit: 100 }).limit).toBe(100);
  });

  it("rejects limit below 1", () => {
    expect(() => getAuditEventsSchema.parse({ limit: 0 })).toThrow();
    expect(() => getAuditEventsSchema.parse({ limit: -1 })).toThrow();
  });

  it("rejects limit above 100", () => {
    expect(() => getAuditEventsSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects non-integer limit", () => {
    expect(() => getAuditEventsSchema.parse({ limit: 1.5 })).toThrow();
  });

  it("coerces string numbers for limit and offset", () => {
    const result = getAuditEventsSchema.parse({ limit: "10", offset: "5" });
    expect(result).toEqual({ limit: 10, offset: 5 });
  });

  it("rejects negative offset", () => {
    expect(() => getAuditEventsSchema.parse({ offset: -1 })).toThrow();
  });

  it("rejects non-integer offset", () => {
    expect(() => getAuditEventsSchema.parse({ offset: 1.5 })).toThrow();
  });

  it("accepts valid cuid for roomId", () => {
    const result = getAuditEventsSchema.parse({
      roomId: "clx123examplecuid12345",
    });
    expect(result.roomId).toBe("clx123examplecuid12345");
  });

  it("rejects malformed roomId", () => {
    expect(() =>
      getAuditEventsSchema.parse({ roomId: "not-a-cuid" }),
    ).toThrow();
  });

  it("accepts valid eventType", () => {
    const result = getAuditEventsSchema.parse({
      eventType: "ADMIN_TERMINATE_ROOM",
    });
    expect(result.eventType).toBe("ADMIN_TERMINATE_ROOM");
  });

  it("rejects empty eventType", () => {
    expect(() => getAuditEventsSchema.parse({ eventType: "" })).toThrow();
  });

  it("rejects eventType exceeding 100 characters", () => {
    expect(() =>
      getAuditEventsSchema.parse({ eventType: "x".repeat(101) }),
    ).toThrow();
  });

  it("accepts eventType of exactly 100 characters", () => {
    const result = getAuditEventsSchema.parse({ eventType: "x".repeat(100) });
    expect(result.eventType).toHaveLength(100);
  });

  it("accepts valid cuid for adminUserId", () => {
    const result = getAuditEventsSchema.parse({
      adminUserId: "clx456examplecuid12345",
    });
    expect(result.adminUserId).toBe("clx456examplecuid12345");
  });

  it("rejects malformed adminUserId", () => {
    expect(() =>
      getAuditEventsSchema.parse({ adminUserId: "also-not-a-cuid" }),
    ).toThrow();
  });

  it("accepts all optional filters together", () => {
    const result = getAuditEventsSchema.parse({
      limit: 10,
      offset: 0,
      roomId: "clx123examplecuid12345",
      eventType: "ADMIN_TERMINATE_ROOM",
      adminUserId: "clx456examplecuid12345",
    });
    expect(result).toEqual({
      limit: 10,
      offset: 0,
      roomId: "clx123examplecuid12345",
      eventType: "ADMIN_TERMINATE_ROOM",
      adminUserId: "clx456examplecuid12345",
    });
  });

  it("omits undefined optional fields from output", () => {
    const result = getAuditEventsSchema.parse({});
    expect(result).not.toHaveProperty("roomId");
    expect(result).not.toHaveProperty("eventType");
    expect(result).not.toHaveProperty("adminUserId");
    expect(result).not.toHaveProperty("createdAfter");
    expect(result).not.toHaveProperty("createdBefore");
  });

  it("coerces ISO createdAfter/createdBefore to Date", () => {
    const result = getAuditEventsSchema.parse({
      createdAfter: "2026-07-01T00:00:00.000Z",
      createdBefore: "2026-07-14T23:59:59.999Z",
    });
    expect(result.createdAfter).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(result.createdBefore).toEqual(new Date("2026-07-14T23:59:59.999Z"));
  });

  it("rejects createdAfter after createdBefore", () => {
    expect(() =>
      getAuditEventsSchema.parse({
        createdAfter: "2026-07-14T00:00:00.000Z",
        createdBefore: "2026-07-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects non-ISO-8601 createdAfter strings", () => {
    expect(() =>
      getAuditEventsSchema.parse({ createdAfter: "07/01/2026" }),
    ).toThrow();
    expect(() =>
      getAuditEventsSchema.parse({ createdAfter: "yesterday" }),
    ).toThrow();
    expect(() => getAuditEventsSchema.parse({ createdAfter: "" })).toThrow();
  });

  it("rejects non-ISO-8601 createdBefore strings", () => {
    expect(() =>
      getAuditEventsSchema.parse({ createdBefore: "07/14/2026" }),
    ).toThrow();
    expect(() =>
      getAuditEventsSchema.parse({ createdBefore: "not-a-date" }),
    ).toThrow();
  });

  it("accepts ISO-8601 with timezone offset", () => {
    const result = getAuditEventsSchema.parse({
      createdAfter: "2026-07-01T07:00:00.000+07:00",
      createdBefore: "2026-07-14T16:59:59.999-08:00",
    });
    expect(result.createdAfter).toBeInstanceOf(Date);
    expect(result.createdBefore).toBeInstanceOf(Date);
    expect(result.createdAfter?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(result.createdBefore?.toISOString()).toBe(
      "2026-07-15T00:59:59.999Z",
    );
  });
});

describe("GET /admin/audit-events validation pipe integration", () => {
  // Wire a minimal controller that mirrors AdminController's
  // getAuditEvents signature: a Zod validation pipe on @Query, a
  // permissive guard (so the route is exercised exactly as in
  // production minus auth concerns), and a mocked AdminService whose
  // `getAuditEvents` we can spy on. The validation pipe is the only
  // thing we want to fail in these tests, so the guard short-circuits
  // to true and lets every request reach the pipe.
  const AllowAllGuard = {
    canActivate: () => true,
  };

  // Token used to inject the mocked AdminService into the test
  // controller. Keeps the controller decoupled from the real
  // AdminService class so we never need to import its prisma/redis
  // collaborators.
  const ADMIN_AUDIT_SERVICE = Symbol("ADMIN_AUDIT_SERVICE");

  @Controller("admin")
  @UseGuards(AllowAllGuard as never)
  class AdminAuditController {
    constructor(
      @Inject(ADMIN_AUDIT_SERVICE)
      private readonly adminService: any,
    ) {}

    @Get("audit-events")
    async getAuditEvents(
      @Query(new ZodValidationPipe(getAuditEventsSchema))
      _query: GetAuditEventsDto,
    ) {
      return this.adminService.getAuditEvents(_query);
    }
  }

  @Module({
    controllers: [AdminAuditController],
    providers: [
      { provide: APP_GUARD, useValue: AllowAllGuard },
      {
        provide: ADMIN_AUDIT_SERVICE,
        useFactory: () => ({ getAuditEvents: vi.fn() }),
      },
    ],
  })
  class AdminAuditTestModule {}

  let app: NestFastifyApplication;
  let adminService: { getAuditEvents: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AdminAuditTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    adminService = moduleRef.get(ADMIN_AUDIT_SERVICE);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    adminService.getAuditEvents.mockReset();
  });

  it("returns 400 with the inverted-range message and does not call AdminService", async () => {
    const res = await app.inject({
      method: "GET",
      url:
        "/admin/audit-events?createdAfter=2026-07-14T00:00:00.000Z" +
        "&createdBefore=2026-07-01T00:00:00.000Z",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining("createdAfter must be <= createdBefore"),
      ]),
    );
    expect(adminService.getAuditEvents).not.toHaveBeenCalled();
  });

  it("returns 400 for non-ISO createdAfter and does not call AdminService", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-events?createdAfter=yesterday",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message.join(" ")).toMatch(/ISO-8601/);
    expect(adminService.getAuditEvents).not.toHaveBeenCalled();
  });

  it("returns 200 and forwards validated, coerced dates to AdminService", async () => {
    const expected = { events: [], total: 0 };
    adminService.getAuditEvents.mockResolvedValueOnce(expected);

    const res = await app.inject({
      method: "GET",
      url:
        "/admin/audit-events" +
        "?createdAfter=2026-07-01T00:00:00.000Z" +
        "&createdBefore=2026-07-14T23:59:59.999Z" +
        "&limit=25" +
        "&offset=0",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expected);
    expect(adminService.getAuditEvents).toHaveBeenCalledTimes(1);
    const callArg = adminService.getAuditEvents.mock.calls[0][0];
    expect(callArg.createdAfter).toBeInstanceOf(Date);
    expect(callArg.createdBefore).toBeInstanceOf(Date);
    expect(callArg.createdAfter.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(callArg.createdBefore.toISOString()).toBe(
      "2026-07-14T23:59:59.999Z",
    );
  });
});

describe("GetAuditEventsDto", () => {
  it("is a class that can be instantiated", () => {
    const dto = new GetAuditEventsDto();
    expect(dto).toBeInstanceOf(GetAuditEventsDto);
  });

  it("has the expected property keys", () => {
    const dto = new GetAuditEventsDto();
    const keys = Object.getOwnPropertyNames(dto);
    expect(keys).toContain("limit");
    expect(keys).toContain("offset");
  });
});
