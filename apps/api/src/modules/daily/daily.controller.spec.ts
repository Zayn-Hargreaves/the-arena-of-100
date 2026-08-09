import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { AuthService } from "../auth/auth.service";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedRequest } from "../auth/auth.types";

const TODAY_RESPONSE = {
  dateKey: "2026-08-09",
  version: 1,
  questions: [],
  sessionToken: "signed-session-token",
  serverTime: "2026-08-09T10:00:00.000Z",
  nextResetAt: "2026-08-10T00:00:00.000Z",
  alreadyAttempted: false,
};

function requestWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe("DailyController", () => {
  let controller: DailyController;
  let service: { getToday: any; submit: any; getLeaderboard: any };
  let auth: { verifyToken: any };

  beforeEach(() => {
    service = {
      getToday: vi.fn().mockResolvedValue(TODAY_RESPONSE),
      submit: vi.fn(),
      getLeaderboard: vi.fn(),
    };
    auth = { verifyToken: vi.fn() };
    controller = new DailyController(
      service as unknown as DailyService,
      auth as unknown as AuthService,
    );
  });

  describe("GET /daily/today", () => {
    it("passes no userId for an anonymous request", async () => {
      const result = await controller.getToday(requestWith({}));

      expect(service.getToday).toHaveBeenCalledWith(undefined);
      expect(auth.verifyToken).not.toHaveBeenCalled();
      expect(result).toEqual(TODAY_RESPONSE);
    });

    it("resolves the userId from a Bearer header", async () => {
      auth.verifyToken.mockReturnValue({ userId: "u1", username: "Alice" });

      await controller.getToday(
        requestWith({ authorization: "Bearer token-123" }),
      );

      expect(auth.verifyToken).toHaveBeenCalledWith("token-123");
      expect(service.getToday).toHaveBeenCalledWith("u1");
    });

    it("resolves the userId from the access-token cookie", async () => {
      auth.verifyToken.mockReturnValue({ userId: "u2", username: "Bob" });

      await controller.getToday(
        requestWith({ cookie: "arena_access_token=cookie-abc" }),
      );

      expect(auth.verifyToken).toHaveBeenCalledWith("cookie-abc");
      expect(service.getToday).toHaveBeenCalledWith("u2");
    });

    it("prefers the Authorization header over the cookie", async () => {
      auth.verifyToken.mockReturnValue({ userId: "u1", username: "Alice" });

      await controller.getToday(
        requestWith({
          authorization: "Bearer header-token",
          cookie: "arena_access_token=cookie-token",
        }),
      );

      expect(auth.verifyToken).toHaveBeenCalledWith("header-token");
    });

    it("degrades to anonymous when the token is invalid", async () => {
      auth.verifyToken.mockImplementation(() => {
        throw new Error("expired");
      });

      const result = await controller.getToday(
        requestWith({ authorization: "Bearer bad-token" }),
      );

      // A bad token must never turn a public route into a 401.
      expect(service.getToday).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(TODAY_RESPONSE);
    });

    it("ignores a non-Bearer Authorization scheme", async () => {
      await controller.getToday(
        requestWith({ authorization: "Basic dXNlcjpwYXNz" }),
      );

      expect(auth.verifyToken).not.toHaveBeenCalled();
      expect(service.getToday).toHaveBeenCalledWith(undefined);
    });
  });

  describe("POST /daily/submit", () => {
    it("forwards the authenticated userId, body and session token", async () => {
      const expected = { dateKey: "2026-08-09", score: 500 };
      service.submit.mockResolvedValue(expected);
      const body = {
        sessionToken: "valid-session-token",
        answers: [{ answer: "A", responseTimeMs: 1000 }],
      };

      const request = {
        user: { userId: "u1", username: "Alice" },
      } as unknown as AuthenticatedRequest;

      const result = await controller.submit(request, body as any);

      expect(service.submit).toHaveBeenCalledWith("u1", body);
      expect(result).toBe(expected);
    });
  });

  describe("GET /daily/leaderboard", () => {
    it("forwards the parsed query", async () => {
      const expected = {
        dateKey: "2026-08-09",
        generatedAt: "2026-08-09T10:00:00.000Z",
        cached: false,
        items: [],
      };
      service.getLeaderboard.mockResolvedValue(expected);

      const result = await controller.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 25,
      });

      expect(service.getLeaderboard).toHaveBeenCalledWith({
        dateKey: "2026-08-09",
        limit: 25,
      });
      expect(result).toBe(expected);
    });

    it("forwards a query without an explicit dateKey", async () => {
      service.getLeaderboard.mockResolvedValue({ items: [] });

      await controller.getLeaderboard({ limit: 50 });

      expect(service.getLeaderboard).toHaveBeenCalledWith({ limit: 50 });
    });
  });
});
