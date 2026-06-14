// ============================================================
// WsValidationPipe - Unit Tests
// ============================================================
//
// C2 fix tests: validates that the WebSocket validation pipe
// accepts well-formed payloads and rejects malformed ones with
// the INVALID_PAYLOAD error code. The pipe is the WS analogue
// of the HTTP ZodValidationPipe; the rest of the gateway relies
// on it as the single point of payload validation.

import { z } from "zod";
import { ErrorCode, RoomError } from "@arena/shared";
import { WsValidationError, WsValidationPipe } from "./ws-validation.pipe";

describe("WsValidationPipe", () => {
  const TestSchema = z.object({
    name: z.string().min(1).max(64),
    age: z.number().int().positive().optional(),
  });

  const buildPipe = () => new WsValidationPipe(TestSchema);

  describe("transform", () => {
    it("returns the parsed payload on success", () => {
      const pipe = buildPipe();
      const result = pipe.transform(
        { name: "Alice", age: 30 },
        { type: "body" },
      );
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("strips unknown keys by default (Zod default behaviour)", () => {
      const pipe = buildPipe();
      const result = pipe.transform(
        {
          name: "Alice",
          extra: "should be dropped",
        },
        { type: "body" },
      );
      expect(result).toEqual({ name: "Alice" });
    });

    it("throws WsValidationError on missing required field", () => {
      const pipe = buildPipe();
      expect(() => pipe.transform({ age: 30 }, { type: "body" })).toThrow(
        WsValidationError,
      );
    });

    it("throws WsValidationError on wrong type", () => {
      const pipe = buildPipe();
      expect(() => pipe.transform({ name: 123 }, { type: "body" })).toThrow(
        WsValidationError,
      );
    });

    it("throws WsValidationError on oversized string", () => {
      const pipe = buildPipe();
      expect(() =>
        pipe.transform({ name: "x".repeat(65) }, { type: "body" }),
      ).toThrow(WsValidationError);
    });

    it("throws WsValidationError on null payload", () => {
      const pipe = buildPipe();
      expect(() => pipe.transform(null, { type: "body" })).toThrow(
        WsValidationError,
      );
    });

    it("throws WsValidationError on non-object payload (e.g. string)", () => {
      const pipe = buildPipe();
      // C2 fix target: a client sending `"hello"` as the entire
      // SUBMIT_ANSWER payload must be rejected, not coerced.
      expect(() => pipe.transform("hello", { type: "body" })).toThrow(
        WsValidationError,
      );
    });

    it("the thrown error has code = INVALID_PAYLOAD", () => {
      const pipe = buildPipe();
      try {
        pipe.transform({}, { type: "body" });
        expect.fail("Expected WsValidationError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(WsValidationError);
        expect((error as WsValidationError).code).toBe(
          ErrorCode.INVALID_PAYLOAD,
        );
      }
    });

    it("the thrown error message contains the field path", () => {
      const pipe = buildPipe();
      try {
        pipe.transform({ age: "not-a-number" }, { type: "body" });
        expect.fail("Expected WsValidationError to be thrown");
      } catch (error) {
        expect((error as WsValidationError).message).toContain("age");
      }
    });

    it("the thrown error message includes the Zod issue path/message", () => {
      // The "Invalid payload" fallback is reserved for the
      // defensive case where Zod produces zero issues. In practice
      // Zod always produces at least one issue (the rejection
      // reason), so the user-facing message includes it. This test
      // pins that contract: the user gets a useful field-level
      // error rather than a generic string.
      const AlwaysFail = z.never();
      const pipe = new WsValidationPipe(AlwaysFail);
      try {
        pipe.transform("anything", { type: "body" });
        expect.fail("Expected WsValidationError to be thrown");
      } catch (error) {
        // z.never() rejects with "Expected never, received string".
        // The pipe must surface that as the user-facing message.
        expect((error as WsValidationError).message).toMatch(/never/);
      }
    });

    it("WsValidationError is a RoomError so existing handler catches work", () => {
      // C2 contract: the error extends RoomError so the existing
      // per-handler catch blocks (which check `error instanceof
      // RoomError`) route it to ErrorCode.INVALID_PAYLOAD without
      // any per-handler changes.
      try {
        buildPipe().transform({}, { type: "body" });
        expect.fail("Expected WsValidationError");
      } catch (error) {
        expect(error).toBeInstanceOf(RoomError);
        expect((error as WsValidationError).code).toBe(
          ErrorCode.INVALID_PAYLOAD,
        );
        expect((error as WsValidationError).name).toBe("WsValidationError");
      }
    });
  });
});
