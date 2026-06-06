import { describe, it, expect, vi, beforeEach } from "vitest";
import { Role } from "@prisma/client";
import { UsersController } from "./users.controller";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let controller: UsersController;
  let service: {
    getMyStats: any;
    getMyHistory: any;
    updateMyAvatar: any;
  };

  const mockReq = {
    user: {
      userId: "u1",
      username: "Alice",
      role: Role.GUEST,
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    service = {
      getMyStats: vi.fn(),
      getMyHistory: vi.fn(),
      updateMyAvatar: vi.fn(),
    };
    controller = new UsersController(service as unknown as UsersService);
  });

  describe("getMyStats", () => {
    it("forwards userId from request to service", async () => {
      const expected = {
        user: {
          id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          role: "GUEST",
        },
        stats: {
          matchesPlayed: 0,
          wins: 0,
          totalScore: 0,
          avgResponseMs: 0,
          accuracy: 0,
          winRate: 0,
          survivalRate: 0,
          totalCorrectAnswers: 0,
        },
      };
      vi.mocked(service.getMyStats).mockResolvedValue(expected);

      const result = await controller.getMyStats(mockReq);

      expect(service.getMyStats).toHaveBeenCalledWith("u1");
      expect(result).toEqual(expected);
    });
  });

  describe("getMyHistory", () => {
    it("forwards userId and query to service", async () => {
      const expected = { items: [], nextCursor: null, hasMore: false };
      vi.mocked(service.getMyHistory).mockResolvedValue(expected);

      const result = await controller.getMyHistory(mockReq, { limit: 5 });

      expect(service.getMyHistory).toHaveBeenCalledWith("u1", { limit: 5 });
      expect(result).toEqual(expected);
    });

    it("supports cursor query param", async () => {
      const expected = { items: [], nextCursor: null, hasMore: false };
      vi.mocked(service.getMyHistory).mockResolvedValue(expected);

      await controller.getMyHistory(mockReq, {
        limit: 10,
        cursor: "cklxxx",
      });

      expect(service.getMyHistory).toHaveBeenCalledWith("u1", {
        limit: 10,
        cursor: "cklxxx",
      });
    });
  });

  describe("updateMyAvatar", () => {
    it("forwards userId and avatar to service", async () => {
      const expected = {
        id: "u1",
        username: "Alice",
        avatar: "tux" as const,
        role: Role.GUEST,
      };
      vi.mocked(service.updateMyAvatar).mockResolvedValue(expected);

      const result = await controller.updateMyAvatar(mockReq, {
        avatar: "tux",
      });

      expect(service.updateMyAvatar).toHaveBeenCalledWith("u1", "tux");
      expect(result).toEqual(expected);
    });
  });
});
