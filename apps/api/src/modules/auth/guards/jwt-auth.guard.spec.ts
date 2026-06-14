import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UnauthorizedException,
  ExecutionContext,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "../auth.service";
import { ACCESS_TOKEN_COOKIE } from "../auth-cookie";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { Role } from "@prisma/client";

type GuardInternals = {
  logger: Logger;
};

interface MockRequest {
  headers: { authorization?: string; cookie?: string };
  user?: unknown;
}

function makeContext(
  req: MockRequest,
  handler: unknown = () => undefined,
  classRef: unknown = undefined,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let authService: { verifyToken: ReturnType<typeof vi.fn> };
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authService = {
      verifyToken: vi.fn(),
    };
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    };
    guard = new JwtAuthGuard(
      authService as unknown as AuthService,
      reflector as unknown as Reflector,
    );
    (guard as unknown as GuardInternals).logger = new Logger(
      JwtAuthGuard.name,
      { timestamp: false },
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  it("returns true for routes marked @Public()", async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? true : false,
    );
    const ctx = makeContext({ headers: {} });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when no token is present (no header, no cookie)", async () => {
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Missing or invalid authorization header",
    );
  });

  it("accepts a Bearer token from the Authorization header", async () => {
    const req: MockRequest = {
      headers: { authorization: "Bearer abc.def.ghi" },
    };
    const payload = { userId: "u1", username: "p1", role: Role.GUEST };
    authService.verifyToken.mockReturnValue(payload);

    const ctx = makeContext(req);
    const ok = await guard.canActivate(ctx);

    expect(ok).toBe(true);
    expect(authService.verifyToken).toHaveBeenCalledWith("abc.def.ghi");
    expect(req.user).toEqual(payload);
  });

  it("falls back to the access token cookie when no header is present", async () => {
    const req: MockRequest = {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=cookie-token` },
    };
    const payload = { userId: "u1", username: "p1", role: Role.GUEST };
    authService.verifyToken.mockReturnValue(payload);

    const ok = await guard.canActivate(makeContext(req));

    expect(ok).toBe(true);
    expect(authService.verifyToken).toHaveBeenCalledWith("cookie-token");
    expect(req.user).toEqual(payload);
  });

  it("rejects an invalid token (verifyToken throws)", async () => {
    const req: MockRequest = { headers: { authorization: "Bearer bad" } };
    authService.verifyToken.mockImplementation(() => {
      throw new UnauthorizedException("Invalid or expired token");
    });

    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a payload missing required fields", async () => {
    const req: MockRequest = { headers: { authorization: "Bearer ok" } };
    authService.verifyToken.mockReturnValue({ role: Role.GUEST } as never);

    // The guard converts "Invalid token payload" into a generic "Invalid or expired token"
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      "Invalid or expired token",
    );
  });

  it("rejects a non-object payload", async () => {
    const req: MockRequest = { headers: { authorization: "Bearer ok" } };
    authService.verifyToken.mockReturnValue("not-an-object" as never);

    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      "Invalid or expired token",
    );
  });
});
