import { describe, it, expect } from "vitest";
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
