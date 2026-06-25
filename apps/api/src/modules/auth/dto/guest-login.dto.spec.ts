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

    it("should mask profanity in the username", () => {
      const parsed = guestLoginSchema.parse({ username: "badshit" });
      expect(parsed.username).toBe("bad****");
    });

    it("should mask obfuscated profanity in the username", () => {
      const inputs = [
        "badsh!it",
        "badsh\u200Bit",
        "badsh-it",
        "badsh_it",
        "badsh it",
        "badsh*it",
        "badshshitit",
        "badｓｈｉｔ",
      ];

      for (const username of inputs) {
        const parsed = guestLoginSchema.parse({ username });
        expect(parsed.username.replace(/[^\p{L}\p{N}]/gu, "")).not.toContain(
          "shit",
        );
      }
    });

    it("should throw if username is less than 3 characters", () => {
      const input = { username: "ab" };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if raw username is too large", () => {
      expect(() =>
        guestLoginSchema.parse({ username: "a".repeat(257) }),
      ).toThrow(ZodError);
    });

    it("should throw if sanitized username is more than 20 characters", () => {
      const input = { username: `valid${"!".repeat(20)}name${"a".repeat(12)}` };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if username is empty or missing", () => {
      const input = { username: "" };
      expect(() => guestLoginSchema.parse(input)).toThrow(ZodError);
      expect(() => guestLoginSchema.parse({})).toThrow(ZodError);
    });

    it("should throw if username is fully filtered", () => {
      expect(() => guestLoginSchema.parse({ username: "!!!" })).toThrow(
        ZodError,
      );
    });

    it("should throw if username has no alphanumeric content", () => {
      expect(() => guestLoginSchema.parse({ username: "***" })).toThrow(
        ZodError,
      );
      expect(() => guestLoginSchema.parse({ username: "---" })).toThrow(
        ZodError,
      );
    });

    it("should reject precomposed accented profanity like fúck", () => {
      expect(() => guestLoginSchema.parse({ username: "fúck" })).toThrow(
        ZodError,
      );
      expect(() => guestLoginSchema.parse({ username: "fúck123" })).toThrow(
        ZodError,
      );
    });

    it("should reject usernames that still contain banned terms after masking", () => {
      expect(() => guestLoginSchema.parse({ username: "fúckshit" })).toThrow(
        ZodError,
      );
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
