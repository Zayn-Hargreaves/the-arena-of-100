// ============================================================
// Class engine tests — Phase 2 (Class + Card Hybrid)
// Source of truth: memory-bank/spec/class-cards-phase.md §2
// (Decision 2: "Random server-side per match").
// ============================================================

import { describe, it, expect } from "vitest";
import { assignClasses } from "./class-engine";

describe("assignClasses — happy path", () => {
  it("returns an assignment per playerId", () => {
    const players = ["p1", "p2", "p3", "p4"];
    const result = assignClasses(players, "seed-1");
    expect(result).toHaveLength(4);
    for (const p of players) {
      const entry = result.find((r) => r.playerId === p);
      expect(entry).toBeDefined();
    }
  });

  it("returns only CONG | THU class ids", () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const result = assignClasses(players, "seed-2");
    for (const r of result) {
      expect(["CONG", "THU"]).toContain(r.classId);
    }
  });

  it("yields an exact 50/50 split for 100 players", () => {
    // Per the roll-and-rank algorithm, 100 players (even count)
    // always produces exactly 50 CONG + 50 THU — no tolerance
    // band is needed (the spec's soft threshold only matters for
    // odd counts).
    const players = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const result = assignClasses(players, "seed-100");
    const cong = result.filter((r) => r.classId === "CONG").length;
    const thu = result.filter((r) => r.classId === "THU").length;
    expect(cong).toBe(50);
    expect(thu).toBe(50);
  });

  it("returns each playerId exactly once (no duplicates)", () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const result = assignClasses(players, "seed-3");
    expect(new Set(result.map((r) => r.playerId)).size).toBe(players.length);
  });
});

describe("assignClasses — determinism", () => {
  it("same seed produces same assignment", () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const a = assignClasses(players, "deterministic-seed");
    const b = assignClasses(players, "deterministic-seed");
    expect(a).toEqual(b);
  });

  it("different seeds produce different mappings (statistical)", () => {
    // The classes-per-position signature is always
    // alternating (CONG,THU,CONG,THU,...) because the
    // implementation assigns via odd/even rank in the
    // roll-sorted order. What VARIES per seed is which
    // playerId lands in each rank. So the test compares
    // the playerId→classId mapping, not the positional
    // signature.
    const players = Array.from({ length: 51 }, (_, i) => `p${i}`);
    const mapA = new Map(
      assignClasses(players, "seed-A").map((r) => [r.playerId, r.classId]),
    );
    const mapB = new Map(
      assignClasses(players, "seed-B").map((r) => [r.playerId, r.classId]),
    );
    let diffs = 0;
    for (const p of players) {
      if (mapA.get(p) !== mapB.get(p)) diffs++;
    }
    // A different seed should produce different mappings for
    // roughly half the players (statistically). 51 players,
    // expect ~25 different — assert strictly between 10 and 40.
    expect(diffs).toBeGreaterThan(10);
    expect(diffs).toBeLessThan(40);
  });

  it("result is invariant to input ordering (sorts by playerId)", () => {
    const a = assignClasses(["p1", "p2", "p3", "p4"], "order-test");
    const b = assignClasses(["p4", "p3", "p2", "p1"], "order-test");
    expect(a).toEqual(b);
  });
});

describe("assignClasses — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(assignClasses([], "empty")).toEqual([]);
  });

  it("handles single player", () => {
    const result = assignClasses(["solo"], "solo-seed");
    expect(result).toHaveLength(1);
    expect(result[0]?.playerId).toBe("solo");
    expect(["CONG", "THU"]).toContain(result[0]?.classId);
  });

  it("handles 2 players — one CONG, one THU", () => {
    const result = assignClasses(["p1", "p2"], "pair-seed");
    const classes = result.map((r) => r.classId).sort();
    expect(classes).toEqual(["CONG", "THU"]);
  });

  it("assigns the extra slot to CONG when player count is odd", () => {
    const result = assignClasses(["p1", "p2", "p3"], "odd-seed");
    const congCount = result.filter((r) => r.classId === "CONG").length;
    const thuCount = result.filter((r) => r.classId === "THU").length;
    expect(congCount).toBe(2);
    expect(thuCount).toBe(1);
  });

  it("handles duplicate playerIds — comparePlayerId returns 0 for equal strings", () => {
    // Coverage for the `comparePlayerId(a, b) === 0` equality
    // branch in the roll-sorted sort. Duplicate IDs force the
    // comparator to return 0 at least once; the roll-sorted
    // assignment must still produce a class for each entry (the
    // engine trusts the caller for input dedup).
    const players = ["a", "a", "b"];
    const result = assignClasses(players, "dup-seed");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.playerId).sort()).toEqual([...players].sort());
  });
});
