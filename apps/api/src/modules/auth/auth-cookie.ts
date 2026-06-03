import { randomBytes } from "crypto";

const ONE_DAY_SECONDS = 24 * 60 * 60;

export const ACCESS_TOKEN_COOKIE = "arena_access_token";
export const REFRESH_TOKEN_COOKIE = "arena_refresh_token";
export const CSRF_TOKEN_COOKIE = "csrf_token";

interface SerializeCookieOptions {
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
}

export function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieOptions,
): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    segments.push("HttpOnly");
  }

  if (options.secure) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", {
    path: "/",
    maxAge: 0,
    sameSite: getSameSiteSetting(),
    httpOnly: true,
    secure,
  });
}

export function getCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const entries = cookieHeader.split(";");
  for (const entry of entries) {
    const [namePart, ...valueParts] = entry.trim().split("=");
    if (namePart !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join("="));
  }

  return null;
}

export function shouldUseSecureCookies(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

export function shouldUseCrossSiteCookies(): boolean {
  return process.env.CROSS_SITE_COOKIES === "true";
}

export function getSameSiteSetting(): "lax" | "none" {
  return shouldUseCrossSiteCookies() ? "none" : "lax";
}

export function resolveAccessTokenCookieMaxAge(ttlSeconds: number): number {
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    return ttlSeconds;
  }

  return ONE_DAY_SECONDS;
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}
