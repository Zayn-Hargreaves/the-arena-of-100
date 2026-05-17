import { guestLoginSchema, GuestLoginDto } from "./guest-login.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("GuestLoginDto & Schema", () => {
  describe("guestLoginSchema", () => {
    it("should validate a correct username", () => {
      const input = { username: "guest_player" };
      const parsed = guestLoginSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should trim the username", () => {
      const input = { username: "  guest_player   " };
      const parsed = guestLoginSchema.parse(input);
      expect(parsed.username).toBe("guest_player");
    });

    it("should throw if username is less than 3 characters", () => {
      const input = { username: "ab" };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if username is more than 20 characters", () => {
      const input = { username: "a".repeat(21) };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if username is empty or missing", () => {
      const input = { username: "" };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
      expect(() => guestLoginSchema.parse({})).toThrow(ZodError);
    });
  });

  describe("GuestLoginDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new GuestLoginDto();
      dto.username = "test_user";
      expect(dto.username).toBe("test_user");
    });
  });
});
