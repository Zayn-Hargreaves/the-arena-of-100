import {
  historyItemSchema,
  historyResponseSchema,
  HistoryItemDto,
  HistoryResponseDto,
} from "./history.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("HistoryDto & Schema", () => {
  describe("historyItemSchema", () => {
    const validItem = {
      matchId: "ckl5g2x1y0000abcd1234efgh",
      playedAt: "2026-05-30T18:24:00.000Z",
      roomCategory: "ALL",
      playerCount: 100,
      rank: 1,
      score: 3200,
      status: "WON" as const,
      durationSec: 312,
    };

    it("should validate a complete history item", () => {
      expect(historyItemSchema.parse(validItem)).toEqual(validItem);
    });

    it("should accept each of the three status values", () => {
      expect(
        historyItemSchema.parse({ ...validItem, status: "WON" }).status,
      ).toBe("WON");
      expect(
        historyItemSchema.parse({ ...validItem, status: "ELIMINATED" }).status,
      ).toBe("ELIMINATED");
      expect(
        historyItemSchema.parse({ ...validItem, status: "ABANDONED" }).status,
      ).toBe("ABANDONED");
    });

    it("should throw if status is not WON/ELIMINATED/ABANDONED", () => {
      expect(() =>
        historyItemSchema.parse({ ...validItem, status: "FINISHED" }),
      ).toThrow(ZodError);
    });

    it("should throw if playerCount is not a positive integer", () => {
      expect(() =>
        historyItemSchema.parse({ ...validItem, playerCount: 0 }),
      ).toThrow(ZodError);
      expect(() =>
        historyItemSchema.parse({ ...validItem, playerCount: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        historyItemSchema.parse({ ...validItem, playerCount: 1.5 }),
      ).toThrow(ZodError);
    });

    it("should throw if rank is not a positive integer", () => {
      expect(() => historyItemSchema.parse({ ...validItem, rank: 0 })).toThrow(
        ZodError,
      );
      expect(() => historyItemSchema.parse({ ...validItem, rank: -1 })).toThrow(
        ZodError,
      );
    });

    it("should throw if score or durationSec is negative", () => {
      expect(() =>
        historyItemSchema.parse({ ...validItem, score: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        historyItemSchema.parse({ ...validItem, durationSec: -1 }),
      ).toThrow(ZodError);
    });

    it("should throw if any field is missing", () => {
      const { matchId, ...rest } = validItem;
      expect(() => historyItemSchema.parse(rest)).toThrow(ZodError);
      void matchId;
    });
  });

  describe("historyResponseSchema", () => {
    const validItem = {
      matchId: "m1",
      playedAt: "2026-05-30T18:24:00.000Z",
      roomCategory: "ALL",
      playerCount: 100,
      rank: 1,
      score: 3200,
      status: "WON" as const,
      durationSec: 312,
    };

    it("should validate a response with items, cursor, and hasMore", () => {
      const input = {
        items: [validItem],
        nextCursor: "ckl5g2x1y0000abcd1234efgh",
        hasMore: true,
      };
      expect(historyResponseSchema.parse(input)).toEqual(input);
    });

    it("should accept an empty items array with null nextCursor", () => {
      const input = { items: [], nextCursor: null, hasMore: false };
      expect(historyResponseSchema.parse(input)).toEqual(input);
    });

    it("should throw if nextCursor is not string or null", () => {
      expect(() =>
        historyResponseSchema.parse({
          items: [],
          nextCursor: 42,
          hasMore: false,
        }),
      ).toThrow(ZodError);
    });

    it("should throw if hasMore is not boolean", () => {
      expect(() =>
        historyResponseSchema.parse({
          items: [],
          nextCursor: null,
          hasMore: "no",
        }),
      ).toThrow(ZodError);
    });

    it("should throw if items is missing", () => {
      expect(() =>
        historyResponseSchema.parse({ nextCursor: null, hasMore: false }),
      ).toThrow(ZodError);
    });
  });

  describe("DTO classes", () => {
    it("HistoryItemDto should instantiate and preserve properties", () => {
      const dto = new HistoryItemDto();
      dto.matchId = "m1";
      dto.playedAt = "2026-05-30T18:24:00.000Z";
      dto.roomCategory = "ALL";
      dto.playerCount = 100;
      dto.rank = 1;
      dto.score = 3200;
      dto.status = "WON";
      dto.durationSec = 312;
      expect(dto.matchId).toBe("m1");
      expect(dto.playedAt).toBe("2026-05-30T18:24:00.000Z");
      expect(dto.roomCategory).toBe("ALL");
      expect(dto.playerCount).toBe(100);
      expect(dto.rank).toBe(1);
      expect(dto.score).toBe(3200);
      expect(dto.status).toBe("WON");
      expect(dto.durationSec).toBe(312);
    });

    it("HistoryResponseDto should instantiate and preserve properties", () => {
      const dto = new HistoryResponseDto();
      dto.items = [];
      dto.nextCursor = null;
      dto.hasMore = false;
      expect(dto.items).toEqual([]);
      expect(dto.nextCursor).toBeNull();
      expect(dto.hasMore).toBe(false);

      dto.nextCursor = "abc";
      dto.hasMore = true;
      expect(dto.nextCursor).toBe("abc");
      expect(dto.hasMore).toBe(true);
    });
  });
});
