import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

describe("AdminController", () => {
  let controller: AdminController;
  let service: {
    syncQuestions: ReturnType<typeof vi.fn>;
    resetSystem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      syncQuestions: vi.fn(),
      resetSystem: vi.fn(),
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
});
