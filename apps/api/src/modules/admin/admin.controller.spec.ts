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
  };

  beforeEach(() => {
    service = {
      syncQuestions: vi.fn(),
      resetSystem: vi.fn(),
      terminateRoom: vi.fn(),
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

      const result = await controller.syncQuestions(dto);

      expect(service.syncQuestions).toHaveBeenCalledWith(false);
      expect(result).toEqual(expected);
    });

    it("propagates errors from AdminService", async () => {
      const dto = { clearExisting: true };
      const error = new Error("Sync failed");
      vi.mocked(service.syncQuestions).mockRejectedValueOnce(error);

      await expect(controller.syncQuestions(dto)).rejects.toThrow(
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

      const result = await controller.resetSystem();

      expect(service.resetSystem).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it("propagates errors from AdminService.resetSystem", async () => {
      const error = new Error("Reset failed");
      vi.mocked(service.resetSystem).mockRejectedValueOnce(error);

      await expect(controller.resetSystem()).rejects.toThrow("Reset failed");
    });
  });

  describe("terminateRoom", () => {
    it("rejects when message is provided (fail-fast until sanitizer lands)", async () => {
      // Note: `message` is currently rejected at the schema boundary
      // because the shared sanitizer pipeline is not yet wired
      // (see terminate-room.dto.ts and plan.md §501). Once it lands,
      // update this test to also assert the message is forwarded.
      const dto = { message: "abandoned by host" };
      const expected = {
        success: true,
        roomId: "r1",
        matchId: "m1",
        message: "Room terminated by admin",
        terminatedAt: 12345,
      };
      vi.mocked(service.terminateRoom).mockResolvedValue(expected);

      // Currently rejects — message field is fail-fast until the
      // sanitizer pipeline lands.
      await expect(controller.terminateRoom("r1", dto)).rejects.toThrow();
      expect(service.terminateRoom).not.toHaveBeenCalled();
    });

    it("forwards the call when message is omitted", async () => {
      vi.mocked(service.terminateRoom).mockResolvedValue({
        success: true,
        roomId: "r1",
        matchId: null,
        message: "Room terminated by admin",
        terminatedAt: 12345,
      });

      const result = await controller.terminateRoom("r1", undefined);

      expect(service.terminateRoom).toHaveBeenCalledWith("r1", undefined);
      expect(result.success).toBe(true);
    });

    it("propagates ROOM_NOT_FOUND from AdminService (controller → 404)", async () => {
      vi.mocked(service.terminateRoom).mockRejectedValueOnce(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );

      await expect(
        controller.terminateRoom("r-missing", undefined),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });

    it("rejects messages longer than 200 characters (zod validation)", async () => {
      const dto = { message: "x".repeat(201) };

      await expect(controller.terminateRoom("r1", dto)).rejects.toThrow();
      expect(service.terminateRoom).not.toHaveBeenCalled();
    });

    it("rejects any message because the sanitizer pipeline is not yet available", async () => {
      // Even a short, well-formed message is rejected at the schema
      // boundary (fail-fast). When the sanitizer lands this test
      // should flip to "forwards the call" semantics.
      const dto = { message: "abandoned" };

      await expect(controller.terminateRoom("r1", dto)).rejects.toThrow();
      expect(service.terminateRoom).not.toHaveBeenCalled();
    });
  });
});
