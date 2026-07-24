// ============================================================
// C3 — verdict unit tests. Pure Node (no k6, no docker): hand-built
// *.failover.json artifacts fed through the pure oracle.
//
//   node_modules/.bin/vitest run --config load-test/vitest.config.mjs
// ============================================================

import { describe, it, expect } from "vitest";
import {
  evaluateFailover,
  dedupeRoundEvents,
  VERDICT,
} from "./failover-verdict.mjs";

// A valid PASS artifact. Tests clone + mutate this.
function baseArtifact() {
  return {
    t_start: 0,
    t_match_started: 0,
    t_kill: 10000,
    t_owner_flip: 15000,
    t_recover: 16000,
    time_to_recover_ms: 6000,
    owner_before: { nodeId: "api-2", fence: 7 },
    owner_after: { nodeId: "api-3", fence: 8 },
    nodes_alive_after: ["api-1", "api-3"],
    rounds_before: 2,
    rounds_after: 2,
    round_events: [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 8000, eventId: "e2", roundIndex: 2, fence: 7 },
      { t: 16000, eventId: "e3", roundIndex: 3, fence: 8 },
      { t: 18000, eventId: "e4", roundIndex: 4, fence: 8 },
    ],
    match_finished: true,
    answer_p95_failover_ms: 100,
    steady_state_p95_ms: 28,
    reconnect: { successes: 20, unexpected_closes: 20, rate: 1.0, p95_ms: 900 },
    thresholds: {
      answer_p95_multiplier_max: 5,
      time_to_recover_max_ms: 20000,
      reconnect_success_min: 0.99,
      min_unexpected_closes: 1,
    },
  };
}

const codes = (r) => r.reasons.map((x) => x.code);

describe("failover verdict — happy path", () => {
  it("PASSes a clean failover artifact", () => {
    const r = evaluateFailover(baseArtifact());
    expect(r.verdict).toBe(VERDICT.PASS);
    expect(r.reasons).toEqual([]);
    expect(r.derived.tRecoverDerived).toBe(16000);
    expect(r.derived.timeToRecoverMs).toBe(6000);
  });
});

describe("Step 0 — derive recovery from evidence", () => {
  it("poll-gap: accepts a new-fence event observed BEFORE the poll noticed the flip", () => {
    // ROUND_STARTED under the new fence at t_kill < t < t_owner_flip.
    const a = baseArtifact();
    a.t_recover = 13000;
    a.time_to_recover_ms = 3000;
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 13000, eventId: "e3", roundIndex: 2, fence: 8 }, // during poll gap
      { t: 18000, eventId: "e4", roundIndex: 3, fence: 8 },
    ];
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.PASS);
    expect(r.derived.tRecoverDerived).toBe(13000); // event chosen, not rejected
    expect(r.derived.timeToRecoverMs).toBe(3000);
  });

  it("rejects an artifact with NO post-kill new-fence event", () => {
    const a = baseArtifact();
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 8000, eventId: "e2", roundIndex: 2, fence: 7 },
    ];
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("invalid_artifact");
  });

  it("rejects when recorded t_recover disagrees with the derived value", () => {
    const a = baseArtifact();
    a.t_recover = 17000; // derived is 16000
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("invalid_artifact");
  });

  it("rejects a broken timeline (t_owner_flip <= t_kill)", () => {
    const a = baseArtifact();
    a.t_owner_flip = 5000; // before the kill
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("invalid_artifact");
  });
});

describe("duplicate-log determinism", () => {
  it("dedupes by eventId keeping the smallest t, order-independent", () => {
    const raw = [
      { t: 16000, eventId: "e3", roundIndex: 3, fence: 8 },
      { t: 16050, eventId: "e3", roundIndex: 3, fence: 8 }, // later dup
      { t: 15990, eventId: "e3", roundIndex: 3, fence: 8 }, // earliest dup
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 5010, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 8000, eventId: "e2", roundIndex: 2, fence: 7 },
    ];
    const shuffled = [raw[3], raw[0], raw[5], raw[2], raw[1], raw[4]];

    const a = dedupeRoundEvents(raw);
    const b = dedupeRoundEvents(shuffled);
    expect(a).toEqual(b); // identical sequence regardless of arrival order
    expect(a.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(a.find((e) => e.eventId === "e3").t).toBe(15990); // smallest t
  });

  it("verdict is byte-identical across shuffled duplicate observations", () => {
    const dupEvents = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 5001, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 8000, eventId: "e2", roundIndex: 2, fence: 7 },
      { t: 15990, eventId: "e3", roundIndex: 3, fence: 8 },
      { t: 16040, eventId: "e3", roundIndex: 3, fence: 8 },
      { t: 18000, eventId: "e4", roundIndex: 4, fence: 8 },
      { t: 18010, eventId: "e4", roundIndex: 4, fence: 8 },
    ];
    const mk = (events) => {
      const a = baseArtifact();
      a.t_recover = 15990; // = canonical smallest t of e3
      a.time_to_recover_ms = 5990;
      a.round_events = events;
      return evaluateFailover(a);
    };
    const order1 = mk(dupEvents);
    const order2 = mk([...dupEvents].reverse());
    expect(order1.verdict).toBe(VERDICT.PASS);
    expect(order1).toEqual(order2); // deterministic verdict + derived fields
  });
});

describe("reconnect coverage gate", () => {
  it("INCONCLUSIVE when zero unexpected closes is the ONLY gap", () => {
    const a = baseArtifact();
    a.reconnect = { successes: 0, unexpected_closes: 0, rate: 1.0, p95_ms: 0 };
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(codes(r)).toEqual(["reconnect_coverage"]);
  });

  it("a real reconnect rate below the min is a FAIL, not INCONCLUSIVE", () => {
    const a = baseArtifact();
    a.reconnect = { successes: 10, unexpected_closes: 20, rate: 0.5, p95_ms: 0 };
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("reconnect_rate");
  });

  it("stays FAIL when a coverage gap coexists with another failure, still surfacing reconnect_coverage", () => {
    const a = baseArtifact();
    a.match_finished = false; // a genuine FAIL criterion
    a.reconnect = { successes: 0, unexpected_closes: 0, rate: 1.0, p95_ms: 0 }; // + coverage gap
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("match_not_finished");
    expect(codes(r)).toContain("reconnect_coverage");
  });

  it("INCONCLUSIVE when unexpected_closes is positive but below a min>1 floor", () => {
    const a = baseArtifact();
    a.thresholds = { ...a.thresholds, min_unexpected_closes: 5 };
    a.reconnect = { successes: 2, unexpected_closes: 2, rate: 1.0, p95_ms: 100 };
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(codes(r)).toEqual(["reconnect_coverage"]);
  });
});

describe("evidence validation + zombie-writer conflicts", () => {
  it("drops observations with non-numeric roundIndex or fence (missing evidence, no false violations)", () => {
    const a = baseArtifact();
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 8000, eventId: "e2", roundIndex: "two", fence: 7 }, // bad roundIndex
      { t: 9000, eventId: "e2b", roundIndex: 2, fence: "eight" }, // bad fence
      { t: 16000, eventId: "e3", roundIndex: 3, fence: 8 },
    ];
    const canon = dedupeRoundEvents(a.round_events);
    expect(canon.map((e) => e.eventId)).toEqual(["e1", "e3"]); // malformed dropped
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.PASS); // no fabricated regression/unknown_fence
  });

  it("FAILs a zombie-writer conflict: same eventId re-observed under a different fence", () => {
    const a = baseArtifact();
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 16000, eventId: "e3", roundIndex: 3, fence: 8 },
      { t: 16500, eventId: "e3", roundIndex: 3, fence: 7 }, // stale owner re-emits r3
      { t: 18000, eventId: "e4", roundIndex: 4, fence: 8 },
    ];
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("duplicate_round_check");
    expect(r.oracle.violations.map((v) => v.code)).toContain(
      "zombie_writer_conflict",
    );
  });

  it("rejects a non-finite threshold override as an invalid artifact", () => {
    const a = baseArtifact();
    a.thresholds = { ...a.thresholds, time_to_recover_max_ms: NaN };
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("invalid_artifact");
  });
});

describe("recovery derivation guards", () => {
  it("skips all recovery derivation when owner_after.fence is non-finite", () => {
    const a = baseArtifact();
    a.owner_after = { nodeId: "api-3", fence: null };
    const r = evaluateFailover(a);
    expect(r.derived.tRecoverDerived).toBeNull();
    expect(r.derived.timeToRecoverMs).toBeNull();
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("fence_not_higher");
  });
});

describe("split-brain + threshold FAILs", () => {
  it("FAILs a stale-fence post-kill broadcast (unique round number, old fence)", () => {
    const a = baseArtifact();
    a.round_events.push({ t: 17000, eventId: "e5", roundIndex: 5, fence: 7 });
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("duplicate_round_check");
    const vcodes = r.oracle.violations.map((v) => v.code);
    expect(vcodes).toContain("stale_fence_post_kill");
  });

  it("FAILs a round-index regression across the kill", () => {
    const a = baseArtifact();
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 3, fence: 7 },
      { t: 16000, eventId: "e3", roundIndex: 2, fence: 8 }, // 3 -> 2
    ];
    a.t_recover = 16000;
    a.time_to_recover_ms = 6000;
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(r.oracle.violations.map((v) => v.code)).toContain("round_regression");
  });

  it("FAILs when the takeover fence is not strictly higher", () => {
    const a = baseArtifact();
    a.owner_after = { nodeId: "api-3", fence: 7 }; // equal to before
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 16000, eventId: "e3", roundIndex: 2, fence: 7 },
    ];
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("fence_not_higher");
  });

  it("FAILs when the owner did not change nodes", () => {
    const a = baseArtifact();
    a.owner_after = { nodeId: "api-2", fence: 8 }; // same node as before
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("owner_unchanged");
  });

  it("FAILs when recovery exceeds the time budget", () => {
    const a = baseArtifact();
    a.round_events = [
      { t: 5000, eventId: "e1", roundIndex: 1, fence: 7 },
      { t: 40000, eventId: "e3", roundIndex: 2, fence: 8 },
    ];
    a.t_recover = 40000;
    a.time_to_recover_ms = 30000; // > 20000 budget
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("recovery_too_slow");
  });

  it("FAILs when MATCH_FINISHED was not delivered", () => {
    const a = baseArtifact();
    a.match_finished = false;
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("match_not_finished");
  });

  it("FAILs when the answer p95 spike exceeds the multiplier", () => {
    const a = baseArtifact();
    a.answer_p95_failover_ms = 500; // 500 > 5 * 28 = 140
    const r = evaluateFailover(a);
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(codes(r)).toContain("answer_p95_spike");
  });
});
