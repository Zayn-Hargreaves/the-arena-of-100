import { refreshSchema, RefreshDto } from "./refresh.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("RefreshDto & Schema", () => {
  describe("refreshSchema", () => {
    it("should validate a correct refresh token", () => {
      const input = { refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." };
      const parsed = refreshSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should throw if refresh token is empty", () => {
      const input = { refreshToken: "" };
      expect(() => refreshSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if refresh token is missing", () => {
      expect(() => refreshSchema.parse({})).toThrow(ZodError);
    });
  });

  describe("RefreshDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new RefreshDto();
      dto.refreshToken = "test_refresh_token";
      expect(dto.refreshToken).toBe("test_refresh_token");
    });
  });
});
