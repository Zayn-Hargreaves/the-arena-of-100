import { describe, it, expect, afterEach } from "vitest";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  serializeCookie,
  clearCookie,
  getCookieValue,
  shouldUseSecureCookies,
  shouldUseCrossSiteCookies,
  getSameSiteSetting,
  resolveAccessTokenCookieMaxAge,
} from "./auth-cookie";

describe("auth-cookie", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("constants", () => {
    it("exports access and refresh cookie names", () => {
      expect(ACCESS_TOKEN_COOKIE).toBe("arena_access_token");
      expect(REFRESH_TOKEN_COOKIE).toBe("arena_refresh_token");
    });
  });

  describe("serializeCookie", () => {
    it("serializes with httpOnly and secure flags when both true", () => {
      const out = serializeCookie("k", "v", {
        maxAge: 3600,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
      expect(out).toContain("k=v");
      expect(out).toContain("Path=/");
      expect(out).toContain("Max-Age=3600");
      expect(out).toContain("SameSite=lax");
      expect(out).toContain("HttpOnly");
      expect(out).toContain("Secure");
    });

    it("omits HttpOnly and Secure flags when false", () => {
      const out = serializeCookie("k", "v", {
        maxAge: 60,
        httpOnly: false,
        secure: false,
        sameSite: "strict",
        path: "/api",
      });
      expect(out).not.toContain("HttpOnly");
      expect(out).not.toContain("Secure");
      expect(out).toContain("SameSite=strict");
    });

    it("URL-encodes the cookie value", () => {
      const out = serializeCookie("k", "a b=c", {
        maxAge: 1,
        httpOnly: false,
        secure: false,
        sameSite: "lax",
        path: "/",
      });
      expect(out).toContain("k=a%20b%3Dc");
    });

    it("clamps Max-Age to a non-negative integer", () => {
      const out = serializeCookie("k", "v", {
        maxAge: 3.7,
        httpOnly: false,
        secure: false,
        sameSite: "lax",
        path: "/",
      });
      expect(out).toContain("Max-Age=3");
    });
  });

  describe("clearCookie", () => {
    it("returns a serialized cookie with empty value and maxAge 0", () => {
      const out = clearCookie("arena_access_token", true);
      expect(out).toContain("arena_access_token=");
      expect(out).toContain("Max-Age=0");
      expect(out).toContain("HttpOnly");
      expect(out).toContain("Secure");
    });

    it("does not include Secure flag when secure is false", () => {
      const out = clearCookie("arena_access_token", false);
      expect(out).not.toContain("Secure");
    });
  });

  describe("getCookieValue", () => {
    it("returns null when cookie header is undefined", () => {
      expect(getCookieValue(undefined, ACCESS_TOKEN_COOKIE)).toBeNull();
    });

    it("returns null when cookie name is not present", () => {
      expect(getCookieValue("other=1; foo=2", ACCESS_TOKEN_COOKIE)).toBeNull();
    });

    it("returns the decoded value when present", () => {
      const v = getCookieValue(
        `foo=1; ${ACCESS_TOKEN_COOKIE}=abc%20def`,
        ACCESS_TOKEN_COOKIE,
      );
      expect(v).toBe("abc def");
    });

    it("handles a value that contains '=' characters", () => {
      const v = getCookieValue(
        `${ACCESS_TOKEN_COOKIE}=a=b=c`,
        ACCESS_TOKEN_COOKIE,
      );
      expect(v).toBe("a=b=c");
    });

    it("returns null on malformed percent-encoded values", () => {
      // %E0 is not a valid UTF-8 sequence; decodeURIComponent throws URIError.
      const v = getCookieValue(
        `${ACCESS_TOKEN_COOKIE}=%E0%A4%A`,
        ACCESS_TOKEN_COOKIE,
      );
      expect(v).toBeNull();
    });
  });

  describe("shouldUseSecureCookies", () => {
    it("is true when NODE_ENV is 'production'", () => {
      expect(shouldUseSecureCookies("production")).toBe(true);
    });

    it("is false for non-production values", () => {
      expect(shouldUseSecureCookies("development")).toBe(false);
      expect(shouldUseSecureCookies(undefined)).toBe(false);
    });
  });

  describe("shouldUseCrossSiteCookies & getSameSiteSetting", () => {
    it("returns 'none' when CROSS_SITE_COOKIES=true", () => {
      process.env.CROSS_SITE_COOKIES = "true";
      expect(shouldUseCrossSiteCookies()).toBe(true);
      expect(getSameSiteSetting()).toBe("none");
    });

    it("returns 'lax' by default", () => {
      delete process.env.CROSS_SITE_COOKIES;
      expect(shouldUseCrossSiteCookies()).toBe(false);
      expect(getSameSiteSetting()).toBe("lax");
    });
  });

  describe("resolveAccessTokenCookieMaxAge", () => {
    it("returns the value when finite and positive", () => {
      expect(resolveAccessTokenCookieMaxAge(123)).toBe(123);
    });

    it("falls back to 24h on non-positive", () => {
      expect(resolveAccessTokenCookieMaxAge(0)).toBe(24 * 60 * 60);
      expect(resolveAccessTokenCookieMaxAge(-1)).toBe(24 * 60 * 60);
    });

    it("falls back to 24h on NaN", () => {
      expect(resolveAccessTokenCookieMaxAge(Number.NaN)).toBe(24 * 60 * 60);
    });
  });
});
