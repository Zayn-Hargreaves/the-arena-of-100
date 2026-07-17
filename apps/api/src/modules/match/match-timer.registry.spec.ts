import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatchTimerRegistry } from "./match-timer.registry";

describe("MatchTimerRegistry", () => {
  let reg: MatchTimerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    reg = new MatchTimerRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("timers", () => {
    it("ensureMatch is idempotent and returns the same set", () => {
      const a = reg.ensureMatch("m1");
      const b = reg.ensureMatch("m1");
      expect(a).toBe(b);
      expect(reg.hasTimers("m1")).toBe(true);
    });

    it("clearTimers cancels every tracked timer and drops the match", () => {
      const spy = vi.fn();
      reg.addTimer("m1", setTimeout(spy, 1000) as unknown as NodeJS.Timeout);
      reg.addTimer("m1", setTimeout(spy, 2000) as unknown as NodeJS.Timeout);

      reg.clearTimers("m1");
      vi.advanceTimersByTime(5000);

      expect(spy).not.toHaveBeenCalled();
      expect(reg.hasTimers("m1")).toBe(false);
    });
  });

  describe("used questions (F2)", () => {
    it("tracks used question ids per match", () => {
      reg.initUsedQuestions("m1");
      reg.markQuestionUsed("m1", "q1");
      reg.markQuestionUsed("m1", "q2");
      expect([...reg.getUsedQuestions("m1")!]).toEqual(["q1", "q2"]);
    });

    it("markQuestionUsed lazily creates the set when uninitialised", () => {
      reg.markQuestionUsed("m1", "q1");
      expect(reg.getUsedQuestions("m1")!.has("q1")).toBe(true);
    });
  });

  describe("expected answers", () => {
    it("defaults to 0 when unset", () => {
      expect(reg.getExpectedAnswers("m1")).toBe(0);
    });

    it("round-trips the stored count", () => {
      reg.setExpectedAnswers("m1", 7);
      expect(reg.getExpectedAnswers("m1")).toBe(7);
    });
  });

  describe("H1 round-end idempotency guard", () => {
    it("beginEndRound acquires once, then blocks until released", () => {
      expect(reg.beginEndRound("m1")).toBe(true);
      expect(reg.beginEndRound("m1")).toBe(false);
      expect(reg.isEndingRound("m1")).toBe(true);

      reg.endEndRound("m1");
      expect(reg.isEndingRound("m1")).toBe(false);
      expect(reg.beginEndRound("m1")).toBe(true);
    });
  });

  describe("B1 match-finish idempotency guard", () => {
    it("beginFinish acquires once, then blocks until released", () => {
      expect(reg.beginFinish("m1")).toBe(true);
      expect(reg.beginFinish("m1")).toBe(false);
      expect(reg.isFinishing("m1")).toBe(true);

      reg.endFinish("m1");
      expect(reg.isFinishing("m1")).toBe(false);
      expect(reg.beginFinish("m1")).toBe(true);
    });
  });

  describe("B1.1 finish-promise tracking", () => {
    it("awaitFinish resolves immediately when no promise is registered", async () => {
      await expect(reg.awaitFinish("m1")).resolves.toBeUndefined();
    });

    it("awaitFinish awaits the registered promise when one is registered", async () => {
      let resolve!: () => void;
      const p = new Promise<void>((r) => {
        resolve = r;
      });
      reg.beginFinish("m1");
      reg.registerFinishPromise("m1", p);

      let settled = false;
      const awaiter = reg.awaitFinish("m1").then(() => {
        settled = true;
      });

      // Not yet resolved
      await Promise.resolve();
      expect(settled).toBe(false);

      // Resolve the tracked promise
      resolve();
      await awaiter;
      expect(settled).toBe(true);
    });

    it("endFinish removes the registered promise so awaitFinish is a no-op after cleanup", async () => {
      let resolve!: () => void;
      const p = new Promise<void>((r) => {
        resolve = r;
      });
      reg.beginFinish("m1");
      reg.registerFinishPromise("m1", p);
      reg.endFinish("m1");

      // After endFinish, awaitFinish should return an already-resolved promise
      // (the map entry was deleted by endFinish).
      await expect(reg.awaitFinish("m1")).resolves.toBeUndefined();
      // Clean up the dangling promise so vitest doesn't warn about unhandled rejections.
      resolve();
    });
  });

  describe("disposeMatch", () => {
    it("clears timers + used questions + expected answers, leaving guards untouched", () => {
      const spy = vi.fn();
      reg.addTimer("m1", setTimeout(spy, 1000) as unknown as NodeJS.Timeout);
      reg.initUsedQuestions("m1");
      reg.markQuestionUsed("m1", "q1");
      reg.setExpectedAnswers("m1", 3);
      reg.beginFinish("m1");

      reg.disposeMatch("m1");
      vi.advanceTimersByTime(5000);

      expect(spy).not.toHaveBeenCalled();
      expect(reg.hasTimers("m1")).toBe(false);
      expect(reg.getUsedQuestions("m1")).toBeUndefined();
      expect(reg.getExpectedAnswers("m1")).toBe(0);
      // disposeMatch does not touch the finish guard (released via finally).
      expect(reg.isFinishing("m1")).toBe(true);
    });
  });
});
