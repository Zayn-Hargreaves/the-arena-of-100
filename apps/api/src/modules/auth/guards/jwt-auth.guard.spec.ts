import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "../auth.service";
import { Reflector } from "@nestjs/core";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let authService: AuthService;
  let reflector: Reflector;

  beforeEach(() => {
    authService = {
      verifyToken: vi.fn(),
    } as unknown as AuthService;

    reflector = {
      getAllAndOverride: vi.fn(),
    } as unknown as Reflector;

    guard = new JwtAuthGuard(authService, reflector);
  });

  const createMockContext = (
    headers: Record<string, string> = {},
  ): ExecutionContext => {
    const request = {
      headers,
      user: undefined,
    };
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  };

  it("should bypass verification if route is public", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(true);
    const context = createMockContext();
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalled();
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it("should successfully authenticate with a valid Bearer token", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({
      authorization: "Bearer valid-jwt-token",
    });
    const payload = { userId: "user-123", username: "john_doe" };
    vi.mocked(authService.verifyToken).mockReturnValue(payload as any);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-jwt-token");
    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual(payload);
  });

  it("should successfully authenticate with a valid cookie access token when header is missing", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({
      cookie: "arena_access_token=cookie-jwt-token",
    });
    const payload = { userId: "user-456", username: "jane_doe" };
    vi.mocked(authService.verifyToken).mockReturnValue(payload as any);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.verifyToken).toHaveBeenCalledWith("cookie-jwt-token");
    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual(payload);
  });

  it("should throw UnauthorizedException if no token is provided in header or cookie", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Missing or invalid authorization header"),
    );
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it("should throw UnauthorizedException if token verification fails", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({
      authorization: "Bearer bad-token",
    });
    vi.mocked(authService.verifyToken).mockImplementation(() => {
      throw new Error("Verification failed");
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Invalid or expired token"),
    );
  });

  it("should throw UnauthorizedException if token verification fails with a non-Error throw", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({
      authorization: "Bearer bad-token-string-throw",
    });
    vi.mocked(authService.verifyToken).mockImplementation(() => {
      throw "Verification failed with string";
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Invalid or expired token"),
    );
  });

  it("should throw UnauthorizedException if token payload is invalid (missing userId/username)", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    const context = createMockContext({
      authorization: "Bearer malformed-token",
    });

    const invalidPayloads = [
      null,
      undefined,
      "not-an-object",
      { username: "only_username" },
      { userId: "only_userid" },
    ];

    for (const payload of invalidPayloads) {
      vi.mocked(authService.verifyToken).mockReturnValue(payload as any);
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired token"),
      );
    }
  });
});
