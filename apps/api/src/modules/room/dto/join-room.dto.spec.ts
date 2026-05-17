import { joinRoomSchema, JoinRoomDto } from "./join-room.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("JoinRoomDto & Schema", () => {
  describe("joinRoomSchema", () => {
    it("should validate a correct 6-character room code", () => {
      const input = { roomCode: "ABCDEF" };
      const parsed = joinRoomSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should throw if room code is less than 6 characters", () => {
      const input = { roomCode: "ABCDE" };
      expect(() => joinRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if room code is more than 6 characters", () => {
      const input = { roomCode: "ABCDEFG" };
      expect(() => joinRoomSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if room code is empty or missing", () => {
      expect(() => joinRoomSchema.parse({ roomCode: "" })).toThrow(ZodError);
      expect(() => joinRoomSchema.parse({})).toThrow(ZodError);
    });
  });

  describe("JoinRoomDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new JoinRoomDto();
      dto.roomCode = "ABCDEF";
      expect(dto.roomCode).toBe("ABCDEF");
    });
  });
});
