import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { ErrorCode, RoomError } from "@arena/shared";

describe("AdminController", () => {
  let controller: AdminController;
  let service: {
    syncQuestions: ReturnType<typeof vi.fn>;
    resetSystem: ReturnType<typeof vi.fn>;
    terminateRoom: ReturnType<typeof vi.fn>;
    getAuditEvents: ReturnType<typeof vi.fn>;
  };
  const adminReq = { user: { userId: "u-admin" } } as any;

  beforeEach(() => {
    service = {
      syncQuestions: vi.fn(),
      resetSystem: vi.fn(),
      terminateRoom: vi.fn(),
      getAuditEvents: vi.fn(),
    };
    controller = new AdminController(service as unknown as AdminService);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("syncQuestions", () => {
    it("delegates to AdminService.syncQuestions with the DTO clearExisting flag", async () => {
      const dto = { clearExisting: false };
      const expected = {
        success: true,
        questionsCount: 5,
        tagsCount: 2,
        relationshipsCount: 3,
      };
      vi.mocked(service.syncQuestions).mockResolvedValue(expected);

      const result = await controller.syncQuestions(adminReq, dto);

      expect(service.syncQuestions).toHaveBeenCalledWith(false, "u-admin");
      expect(result).toEqual(expected);
    });

    it("defaults clearExisting to true when the body is omitted", async () => {
      const expected = {
        success: true,
        questionsCount: 5,
        tagsCount: 2,
        relationshipsCount: 3,
      };
      vi.mocked(service.syncQuestions).mockResolvedValue(expected);

      const result = await controller.syncQuestions(adminReq, undefined);

      expect(service.syncQuestions).toHaveBeenCalledWith(true, "u-admin");
      expect(result).toEqual(expected);
    });

    it("propagates errors from AdminService", async () => {
      const dto = { clearExisting: true };
      const error = new Error("Sync failed");
      vi.mocked(service.syncQuestions).mockRejectedValueOnce(error);

      await expect(controller.syncQuestions(adminReq, dto)).rejects.toThrow(
        "Sync failed",
      );
    });
  });

  describe("resetSystem", () => {
    it("delegates to AdminService.resetSystem and returns the result", async () => {
      const expected = {
        success: true,
        message:
          "System reset complete. All active rooms, players, matches, and Redis cache cleared successfully.",
      };
      vi.mocked(service.resetSystem).mockResolvedValue(expected);

      const result = await controller.resetSystem(adminReq);

      expect(service.resetSystem).toHaveBeenCalledTimes(1);
      expect(service.resetSystem).toHaveBeenCalledWith("u-admin");
      expect(result).toEqual(expected);
    });

    it("propagates errors from AdminService.resetSystem", async () => {
      const error = new Error("Reset failed");
      vi.mocked(service.resetSystem).mockRejectedValueOnce(error);

      await expect(controller.resetSystem(adminReq)).rejects.toThrow(
        "Reset failed",
      );
    });
  });

  describe("terminateRoom", () => {
    it("accepts and forwards when message is provided (sanitizer pipeline is wired)", async () => {
      const dto = { message: "  abandoned by host  " };
      const expected = {
        success: true,
        roomId: "r1",
        matchId: "m1",
        message: "abandoned by host",
        terminatedAt: 12345,
      };
      vi.mocked(service.terminateRoom).mockResolvedValue(expected);

      const result = await controller.terminateRoom(adminReq, "r1", dto);

      expect(service.terminateRoom).toHaveBeenCalledWith(
        "r1",
        "u-admin",
        "abandoned by host",
      );
      expect(result).toEqual(expected);
    });

    it("forwards the call when message is omitted", async () => {
      vi.mocked(service.terminateRoom).mockResolvedValue({
        success: true,
        roomId: "r1",
        matchId: null,
        message: "Room terminated by admin",
        terminatedAt: 12345,
      });

      const result = await controller.terminateRoom(adminReq, "r1", undefined);

      expect(service.terminateRoom).toHaveBeenCalledWith(
        "r1",
        "u-admin",
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it("propagates ROOM_NOT_FOUND from AdminService (controller → 404)", async () => {
      vi.mocked(service.terminateRoom).mockRejectedValueOnce(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );

      await expect(
        controller.terminateRoom(adminReq, "r-missing", undefined),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });

    it("rejects messages longer than 200 characters (zod validation)", async () => {
      const dto = { message: "x".repeat(201) };

      await expect(
        controller.terminateRoom(adminReq, "r1", dto),
      ).rejects.toThrow();
      expect(service.terminateRoom).not.toHaveBeenCalled();
    });

    it("replaces unsafe message content with the default fallback", async () => {
      const dto = { message: "bad shit" };
      const expected = {
        success: true,
        roomId: "r1",
        matchId: "m1",
        message: "Room terminated by admin",
        terminatedAt: 12345,
      };
      vi.mocked(service.terminateRoom).mockResolvedValue(expected);

      const result = await controller.terminateRoom(adminReq, "r1", dto);

      expect(service.terminateRoom).toHaveBeenCalledWith(
        "r1",
        "u-admin",
        "Room terminated by admin",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("getAuditEvents", () => {
    it("delegates validated query params to AdminService.getAuditEvents", async () => {
      const expected = { events: [{ id: "evt-1" }], total: 1 };
      vi.mocked(service.getAuditEvents).mockResolvedValue(expected);

      const result = await controller.getAuditEvents({
        limit: 25,
        offset: 5,
        roomId: "clx123examplecuid",
        eventType: "ADMIN_TERMINATE_ROOM",
        adminUserId: "clx456examplecuid",
      } as any);

      expect(service.getAuditEvents).toHaveBeenCalledWith({
        limit: 25,
        offset: 5,
        roomId: "clx123examplecuid",
        eventType: "ADMIN_TERMINATE_ROOM",
        adminUserId: "clx456examplecuid",
      });
      expect(result).toEqual(expected);
    });
  });
});
