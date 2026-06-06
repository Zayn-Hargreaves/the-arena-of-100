import { createRoomSchema, CreateRoomDto } from "./create-room.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { QuestionCategory } from "../../question/dto/get-questions.dto";

describe("CreateRoomDto & Schema", () => {
  describe("createRoomSchema", () => {
    it("should validate a correct room type without maxPlayers", () => {
      const input = { roomType: "PUBLIC" };
      const parsed = createRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should validate a correct private room with maxPlayers", () => {
      const input = { roomType: "PRIVATE", maxPlayers: 50 };
      const parsed = createRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should throw if roomType is invalid", () => {
      const input = { roomType: "INVALID" };
      expect(() => createRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if maxPlayers is too small", () => {
      const input = { roomType: "PUBLIC", maxPlayers: 1 };
      expect(() => createRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if maxPlayers is too large", () => {
      const input = { roomType: "PUBLIC", maxPlayers: 101 };
      expect(() => createRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if maxPlayers is a decimal number", () => {
      const input = { roomType: "PUBLIC", maxPlayers: 50.5 };
      expect(() => createRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should validate when category is a valid enum value", () => {
      const input = { roomType: "PUBLIC", category: QuestionCategory.SCIENCE };
      const parsed = createRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should validate when category is 'ALL'", () => {
      const input = { roomType: "PUBLIC", category: "ALL" };
      const parsed = createRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should validate when category is omitted", () => {
      const input = { roomType: "PUBLIC" };
      const parsed = createRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should throw if category is an invalid string", () => {
      const input = { roomType: "PUBLIC", category: "INVALID_CATEGORY" };
      expect(() => createRoomSchema.parse(input)).toThrow(ZodError);
    });
  });

  describe("CreateRoomDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new CreateRoomDto();
      dto.roomType = "PUBLIC";
      dto.maxPlayers = 100;
      expect(dto.roomType).toBe("PUBLIC");
      expect(dto.maxPlayers).toBe(100);
    });
  });
});
