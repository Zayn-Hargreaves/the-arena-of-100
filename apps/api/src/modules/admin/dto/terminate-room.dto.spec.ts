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

    it("rejects any `message` value (superRefine fail-fast — sanitizer pipeline not yet available)", () => {
      // The schema intentionally rejects every message until the shared
      // profanity/content-sanitizer pipeline (plan.md §501) lands. This
      // guarantees unmoderated text cannot be shipped to players via the
      // kill-switch ROOM_TERMINATED event.
      const result = terminateRoomSchema.safeParse({
        message: "Abandoned by host",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["message"]);
        expect(result.error.issues[0]?.message).toContain(
          "Admin message disabled",
        );
      }
    });

    it("rejects a non-string message", () => {
      expect(() =>
        terminateRoomSchema.parse({ message: 42 as unknown as string }),
      ).toThrow();
    });

    it("rejects a message longer than 200 characters", () => {
      const longMessage = "a".repeat(201);
      // The .max(200) check fires before the superRefine, so the error
      // message is the zod default for string length, not the fail-fast
      // "Admin message disabled" message.
      expect(() =>
        terminateRoomSchema.parse({ message: longMessage }),
      ).toThrow();
    });

    it("exposes a Zod schema instance (type-system contract)", () => {
      // superRefine wraps the base z.object in a ZodEffects — assert the
      // wrapper instead of the inner object to reflect the real shape.
      expect(terminateRoomSchema).toBeInstanceOf(z.ZodEffects);
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
