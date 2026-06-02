import { describe, it, expect } from "vitest";
import {
  syncQuestionsSchema,
  SyncQuestionsDto,
  type SyncQuestionsInput,
} from "./sync-questions.dto";

describe("SyncQuestionsDto & Schema", () => {
  describe("syncQuestionsSchema", () => {
    it("should default clearExisting to true when omitted", () => {
      const parsed = syncQuestionsSchema.parse({});
      expect(parsed.clearExisting).toBe(true);
    });

    it("should accept an explicit true", () => {
      const parsed = syncQuestionsSchema.parse({ clearExisting: true });
      expect(parsed.clearExisting).toBe(true);
    });

    it("should accept an explicit false", () => {
      const parsed = syncQuestionsSchema.parse({ clearExisting: false });
      expect(parsed.clearExisting).toBe(false);
    });

    it("should reject non-boolean clearExisting values", () => {
      expect(() =>
        syncQuestionsSchema.parse({
          clearExisting: "yes" as unknown as boolean,
        }),
      ).toThrow();
    });
  });

  describe("SyncQuestionsDto class", () => {
    it("should instantiate and preserve assigned properties", () => {
      const dto = new SyncQuestionsDto();
      dto.clearExisting = false;
      const asInput = dto as SyncQuestionsInput;
      expect(asInput.clearExisting).toBe(false);
    });
  });
});
