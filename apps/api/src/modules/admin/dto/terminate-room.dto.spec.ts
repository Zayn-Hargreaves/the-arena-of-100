import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  terminateRoomSchema,
  TerminateRoomDto,
  type TerminateRoomInput,
} from "./terminate-room.dto";

describe("TerminateRoomDto & Schema", () => {
  describe("terminateRoomSchema", () => {
    it("accepts an empty body (no message field)", () => {
      const parsed = terminateRoomSchema.parse({});
      expect(parsed.message).toBeUndefined();
    });

    it("accepts an explicit `undefined` message", () => {
      const parsed = terminateRoomSchema.parse({ message: undefined });
      expect(parsed.message).toBeUndefined();
    });

    it("accepts and trims a clean message", () => {
      const parsed = terminateRoomSchema.parse({
        message: "  Abandoned by host   ",
      });
      expect(parsed.message).toBe("Abandoned by host");
    });

    it("replaces unsafe message content with the default fallback", () => {
      const parsed = terminateRoomSchema.parse({ message: "bad shit" });
      expect(parsed.message).toBe("Room terminated by admin");
    });

    it("rejects a non-string message", () => {
      expect(() =>
        terminateRoomSchema.parse({ message: 42 as unknown as string }),
      ).toThrow();
    });

    it("rejects a message longer than 200 characters", () => {
      const longMessage = "a".repeat(201);
      expect(() =>
        terminateRoomSchema.parse({ message: longMessage }),
      ).toThrow();
    });

    it("exposes a Zod schema instance (type-system contract)", () => {
      expect(terminateRoomSchema).toBeInstanceOf(z.ZodObject);
    });
  });

  describe("TerminateRoomDto class", () => {
    it("instantiates with an empty message (default)", () => {
      const dto = new TerminateRoomDto();
      const asInput = dto as TerminateRoomInput;
      expect(asInput.message).toBeUndefined();
    });

    it("preserves an assigned message value (DTO is a plain carrier — validation happens at parse time)", () => {
      const dto = new TerminateRoomDto();
      dto.message = "Pending pipeline";
      const asInput = dto as TerminateRoomInput;
      expect(asInput.message).toBe("Pending pipeline");
    });
  });
});
