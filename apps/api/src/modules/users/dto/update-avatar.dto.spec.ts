import { updateAvatarSchema, UpdateAvatarDto } from "./update-avatar.dto";
import { AVATAR_SEEDS } from "@arena/shared";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("UpdateAvatarDto & Schema", () => {
  describe("updateAvatarSchema", () => {
    it("should accept every seed in AVATAR_SEEDS", () => {
      for (const seed of AVATAR_SEEDS) {
        expect(updateAvatarSchema.parse({ avatar: seed }).avatar).toBe(seed);
      }
    });

    it("should throw if avatar is missing", () => {
      expect(() => updateAvatarSchema.parse({})).toThrow(ZodError);
    });

    it("should throw if avatar is not a known seed", () => {
      expect(() =>
        updateAvatarSchema.parse({ avatar: "not-a-real-avatar" }),
      ).toThrow(ZodError);
      expect(() => updateAvatarSchema.parse({ avatar: "" })).toThrow(ZodError);
    });

    it("should throw if avatar is the wrong type", () => {
      expect(() => updateAvatarSchema.parse({ avatar: 42 })).toThrow(ZodError);
      expect(() => updateAvatarSchema.parse({ avatar: null })).toThrow(
        ZodError,
      );
    });
  });

  describe("UpdateAvatarDto class", () => {
    it("should instantiate and preserve assigned avatar", () => {
      const dto = new UpdateAvatarDto();
      dto.avatar = "tux";
      expect(dto.avatar).toBe("tux");
    });

    it("should allow any of the AVATAR_SEEDS values to be assigned", () => {
      for (const seed of AVATAR_SEEDS) {
        const dto = new UpdateAvatarDto();
        dto.avatar = seed;
        expect(dto.avatar).toBe(seed);
      }
    });
  });
});
