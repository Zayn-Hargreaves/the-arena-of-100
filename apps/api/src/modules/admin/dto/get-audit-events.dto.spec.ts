import { describe, it, expect } from "vitest";
import { getAuditEventsSchema } from "./get-audit-events.dto";

describe("getAuditEventsSchema", () => {
  it("accepts valid query params and applies defaults", () => {
    const result = getAuditEventsSchema.parse({});

    expect(result).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it("rejects limit above 100", () => {
    expect(() => getAuditEventsSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => getAuditEventsSchema.parse({ offset: -1 })).toThrow();
  });

  it("rejects malformed cuid filters", () => {
    expect(() =>
      getAuditEventsSchema.parse({ roomId: "not-a-cuid" }),
    ).toThrow();
    expect(() =>
      getAuditEventsSchema.parse({ adminUserId: "also-not-a-cuid" }),
    ).toThrow();
  });
});
