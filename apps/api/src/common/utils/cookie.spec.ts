import { parseCookies, getCookieValue, serializeCookie } from "./cookie";
import { describe, it, expect } from "vitest";

describe("Cookie Utils", () => {
  describe("parseCookies", () => {
    it("should return empty object if no cookie header provided", () => {
      expect(parseCookies()).toEqual({});
      expect(parseCookies(undefined)).toEqual({});
      expect(parseCookies("")).toEqual({});
    });

    it("should parse standard cookies correctly", () => {
      const header =
        "arena_access_token=token123; arena_refresh_token=refresh456";
      expect(parseCookies(header)).toEqual({
        arena_access_token: "token123",
        arena_refresh_token: "refresh456",
      });
    });

    it("should handle key-value pairs without '=' character gracefully", () => {
      const header = "invalid_cookie; valid_cookie=value";
      expect(parseCookies(header)).toEqual({
        valid_cookie: "value",
      });
    });

    it("should decode URI encoded cookie values", () => {
      const header = "user=John%20Doe; role=GUEST";
      expect(parseCookies(header)).toEqual({
        user: "John Doe",
        role: "GUEST",
      });
    });

    it("should fallback to raw value if decodeURIComponent throws an error", () => {
      const header = "bad_cookie=%E0%A4%A; good_cookie=ok";
      expect(parseCookies(header)).toEqual({
        bad_cookie: "%E0%A4%A",
        good_cookie: "ok",
      });
    });

    it("should ignore empty cookie names", () => {
      const header = "=value; name=val";
      expect(parseCookies(header)).toEqual({
        name: "val",
      });
    });
  });

  describe("getCookieValue", () => {
    it("should return the correct cookie value when present", () => {
      const header = "foo=bar; baz=qux";
      expect(getCookieValue(header, "foo")).toBe("bar");
      expect(getCookieValue(header, "baz")).toBe("qux");
    });

    it("should return undefined if cookie name not found or header undefined", () => {
      expect(getCookieValue("foo=bar", "nonexistent")).toBeUndefined();
      expect(getCookieValue(undefined, "foo")).toBeUndefined();
    });
  });

  describe("serializeCookie", () => {
    it("should serialize cookie with standard key-value pair and default options", () => {
      const serialized = serializeCookie("name", "value");
      expect(serialized).toBe("name=value; Path=/");
    });

    it("should support maxAge option", () => {
      const serialized = serializeCookie("name", "value", { maxAge: 3600 });
      expect(serialized).toBe("name=value; Max-Age=3600; Path=/");
    });

    it("should support httpOnly option", () => {
      const serialized = serializeCookie("name", "value", { httpOnly: true });
      expect(serialized).toBe("name=value; Path=/; HttpOnly");
    });

    it("should support secure option", () => {
      const serialized = serializeCookie("name", "value", { secure: true });
      expect(serialized).toBe("name=value; Path=/; Secure");
    });

    it("should support sameSite option", () => {
      const serialized = serializeCookie("name", "value", { sameSite: "lax" });
      expect(serialized).toBe("name=value; Path=/; SameSite=lax");
    });

    it("should combine multiple options correctly", () => {
      const serialized = serializeCookie("name", "value", {
        maxAge: 86400,
        path: "/custom",
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      });
      expect(serialized).toBe(
        "name=value; Max-Age=86400; Path=/custom; HttpOnly; Secure; SameSite=strict",
      );
    });
  });
});
