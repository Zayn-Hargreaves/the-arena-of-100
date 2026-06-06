import { historyQuerySchema, HistoryQueryDto } from "./history-query.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("HistoryQueryDto & Schema", () => {
  describe("historyQuerySchema", () => {
    it("should default limit to 20 when omitted", () => {
      const parsed = historyQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
    });

    it("should coerce string limit to number", () => {
      const parsed = historyQuerySchema.parse({ limit: "5" });
      expect(parsed.limit).toBe(5);
    });

    it("should accept an explicit integer limit within bounds", () => {
      expect(historyQuerySchema.parse({ limit: 1 }).limit).toBe(1);
      expect(historyQuerySchema.parse({ limit: 50 }).limit).toBe(50);
    });

    it("should throw if limit is less than 1 or greater than 50", () => {
      expect(() => historyQuerySchema.parse({ limit: 0 })).toThrow(ZodError);
      expect(() => historyQuerySchema.parse({ limit: 51 })).toThrow(ZodError);
    });

    it("should throw if limit is not coercible to a finite number", () => {
      expect(() => historyQuerySchema.parse({ limit: "abc" })).toThrow(
        ZodError,
      );
    });

    it("should accept a valid cuid cursor", () => {
      const input = { limit: 10, cursor: "ckl5g2x1y0000abcd1234efgh" };
      expect(historyQuerySchema.parse(input)).toEqual(input);
    });

    it("should throw if cursor is not a valid cuid", () => {
      expect(() =>
        historyQuerySchema.parse({ limit: 10, cursor: "not-a-cuid" }),
      ).toThrow(ZodError);
      expect(() => historyQuerySchema.parse({ limit: 10, cursor: "" })).toThrow(
        ZodError,
      );
    });

    it("should omit cursor when not provided", () => {
      const parsed = historyQuerySchema.parse({});
      expect(parsed.cursor).toBeUndefined();
    });
  });

  describe("HistoryQueryDto class", () => {
    it("should instantiate and preserve properties", () => {
      const dto = new HistoryQueryDto();
      dto.limit = 10;
      dto.cursor = "ckl5g2x1y0000abcd1234efgh";
      expect(dto.limit).toBe(10);
      expect(dto.cursor).toBe("ckl5g2x1y0000abcd1234efgh");
    });

    it("should allow cursor to be omitted", () => {
      const dto = new HistoryQueryDto();
      dto.limit = 20;
      expect(dto.limit).toBe(20);
      expect(dto.cursor).toBeUndefined();
    });
  });
});
