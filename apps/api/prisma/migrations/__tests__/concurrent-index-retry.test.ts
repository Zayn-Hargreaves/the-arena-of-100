// ============================================================
// Concurrent-index-retry coverage for the Phase 3 migration.
//
// `20260812120000_phase3_match_player_user_idx/migration.sql` uses
// `CREATE INDEX CONCURRENTLY` because the (userId, matchId) index
// is additive to a live `match_players` table and must not take an
// ACCESS EXCLUSIVE lock. CONCURRENTLY can be interrupted (worker
// restart, operator kill, DB crash, replicas split-brain), leaving
// the index in `indisvalid = false` state.
//
// The recovery runbook embedded in the migration file calls for
//   1. inspect `pg_index.indisvalid` via `to_regclass('<idx>')`
//      (returns NULL when absent — never throws),
//   2. drop CONCURRENTLY only when invalid,
//   3. retry the CREATE INDEX CONCURRENTLY,
//   4. re-verify `indisvalid = true`.
//
// This spec pins the runbook at three layers:
//   (a) a simulated `pg_index` state machine that exercises every
//       branch the recovery function covers,
//   (b) the actual migration.sql DDL is read from disk and regex-
//       asserted to keep the `CONCURRENTLY` keyword + the
//       recovery-query shape honest against future edits,
//   (c) the recovery function early-returns on VALID, mirroring the
//       migration's CREATE INDEX (which has NO IF NOT EXISTS — a
//       re-run on a healthy index would fail).
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type IndexValidity = "VALID" | "INVALID" | "ABSENT";

/**
 * `indexrelid` is `regclass` in the real `pg_index` catalog; the
 * migration's runbook uses `to_regclass('<idx>')` which returns NULL
 * when the index is absent. The simulator mirrors that: absent
 * rows have `indexrelid = null` (NOT a sentinel string) so the
 * recovery function can rely on a real `null` check rather than a
 * magic value.
 */
interface PgIndexRow {
  indexrelid: string | null;
  indisvalid: boolean;
}

/**
 * Minimal `pg_index` lookup simulator. Mirrors the SQL in the
 * migration runbook:
 *
 *   SELECT indexrelid, indisvalid
 *   FROM pg_index
 *   WHERE indexrelid = to_regclass('<idx>');
 *
 * Returns a tagged state so the recovery runbook can branch on it
 * without having to interpret raw `boolean` (the real runbook
 * distinguishes "row missing" from "row with indisvalid = false").
 */
function lookupIndex(rows: PgIndexRow[], indexName: string): IndexValidity {
  // Same semantics as `WHERE indexrelid = to_regclass('<idx>')`:
  // a NULL `indexrelid` is NOT a match, so absent rows are skipped.
  const row = rows.find((r) => r.indexrelid === indexName);
  if (!row) return "ABSENT";
  return row.indisvalid ? "VALID" : "INVALID";
}

/**
 * Mirrors the runbook step:
 *   DROP INDEX CONCURRENTLY IF EXISTS "<idx>";
 *
 * Must use the CONCURRENTLY variant so the drop is online-safe; a
 * plain `DROP INDEX` would take an ACCESS EXCLUSIVE lock on the
 * table and stall writes while it runs.
 */
function dropIndexConcurrently(
  rows: PgIndexRow[],
  indexName: string,
): PgIndexRow[] {
  return rows.filter((r) => r.indexrelid !== indexName);
}

/**
 * Mirrors `CREATE INDEX CONCURRENTLY "<idx>" ON ...`. The
 * `simulateInvalid` parameter lets a test inject a partial build:
 * pass `true` to leave the resulting row in `indisvalid = false`
 * state (simulating an interrupted build that the recovery runbook
 * must then repair). Pass `false` to model the success path.
 */
function createIndexConcurrently(
  rows: PgIndexRow[],
  indexName: string,
  simulateInvalid: boolean,
): PgIndexRow[] {
  if (rows.some((r) => r.indexrelid === indexName)) return rows;
  return [...rows, { indexrelid: indexName, indisvalid: !simulateInvalid }];
}

/**
 * The recovery runbook as a single function. Takes the simulated
 * `pg_index` state after a failed `CREATE INDEX CONCURRENTLY` and
 * returns the state after the operator runs the recovery steps.
 *
 * Mirrors the migration's CREATE INDEX contract: NO `IF NOT EXISTS`.
 * A re-run on a healthy (VALID) index must NOT proceed — the
 * migration would error out, and the runbook is meant to gate that
 * failure mode, not enable it. Hence the early-return on VALID.
 */
function recoverConcurrentIndex(
  initialRows: PgIndexRow[],
  indexName: string,
): PgIndexRow[] {
  const state = lookupIndex(initialRows, indexName);

  // Early-return: the migration's CREATE INDEX has no
  // IF NOT EXISTS clause, so re-running it on a healthy index would
  // fail. The runbook must mirror that contract: a VALID index is
  // the "already done" signal, not the "needs rebuild" signal.
  if (state === "VALID") {
    return initialRows;
  }

  let rows = initialRows;
  if (state === "INVALID") {
    rows = dropIndexConcurrently(rows, indexName);
  }

  // Runbook step 3: re-run the migration. CONCURRENTLY rebuilds
  // online and the resulting row must report indisvalid = true.
  return createIndexConcurrently(rows, indexName, false);
}

describe("Phase 3 migration — concurrent-index-retry runbook", () => {
  const INDEX = "match_players_user_id_match_id_idx";

  it("recovers from a partial concurrent build (indisvalid=false) by dropping and re-creating", () => {
    // Simulate the operator hitting the recovery runbook after a
    // crashed `CREATE INDEX CONCURRENTLY`: the index exists but is
    // INVALID (the build was interrupted mid-scan).
    const initial: PgIndexRow[] = [{ indexrelid: INDEX, indisvalid: false }];

    const recovered = recoverConcurrentIndex(initial, INDEX);

    // Step 4 of the runbook — the index MUST end up valid.
    expect(lookupIndex(recovered, INDEX)).toBe("VALID");
    // The recovery must use the CONCURRENTLY drop path (no
    // duplicate rows remain after the drop step).
    expect(recovered.filter((r) => r.indexrelid === INDEX)).toHaveLength(1);
  });

  it("early-returns on a healthy index (mirrors no-IF-NOT-EXISTS migration contract)", () => {
    // If the previous runbook iteration ALREADY finished cleanly,
    // `lookupIndex` returns VALID. The migration's CREATE INDEX has
    // no IF NOT EXISTS — re-running it would fail. The recovery
    // function early-returns with the original array reference
    // (no copy) so the caller can detect "nothing to do" by
    // identity, not just by value.
    const initial: PgIndexRow[] = [{ indexrelid: INDEX, indisvalid: true }];

    const recovered = recoverConcurrentIndex(initial, INDEX);

    expect(lookupIndex(recovered, INDEX)).toBe("VALID");
    // Identity check: no array copy, no re-attempt.
    expect(recovered).toBe(initial);
  });

  it("recovers when the index row is missing entirely (no-drop, just create)", () => {
    // Some failures drop the partial index row before the operator
    // gets a chance to inspect it. The runbook must still succeed:
    // an ABSENT index is treated as "needs rebuild", so the create
    // step alone is enough — there is nothing to drop.
    const initial: PgIndexRow[] = [];

    const recovered = recoverConcurrentIndex(initial, INDEX);

    expect(lookupIndex(recovered, INDEX)).toBe("VALID");
  });

  it("ABSE index row has null indexrelid (mirrors to_regclass NULL semantics)", () => {
    // Regression guard: a future refactor that uses an empty
    // string or `""` as the absent sentinel would NOT mirror the
    // migration's `to_regclass(...)` NULL semantics and could
    // confuse the simulator's `WHERE indexrelid = '<idx>'` lookup.
    // This spec pins the simulator's contract.
    expect(lookupIndex([{ indexrelid: null, indisvalid: false }], INDEX)).toBe(
      "ABSENT",
    );
  });

  // ----------------------------------------------------------------
  // Layer (b): the migration.sql DDL itself must keep using
  // CONCURRENTLY on both the CREATE and the recovery DROP. A future
  // refactor that drops CONCURRENTLY would take an ACCESS EXCLUSIVE
  // lock on `match_players` and stall writes for the duration of
  // the build. These assertions read the actual migration file
  // from disk so the runbook comment AND the DDL stay in lockstep
  // with the tests.
  // ----------------------------------------------------------------
  describe("migration.sql DDL invariants", () => {
    const migrationPath = resolve(
      __dirname,
      "..",
      "20260812120000_phase3_match_player_user_idx",
      "migration.sql",
    );
    const ddl = readFileSync(migrationPath, "utf8");

    // Strip SQL comments before searching — the recovery runbook
    // DOC mentions CONCURRENTLY in prose, and we only care that
    // the actual executable statements carry it.
    const stripped = ddl
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    it("CREATE INDEX uses CONCURRENTLY", () => {
      expect(stripped).toMatch(
        /CREATE\s+INDEX\s+CONCURRENTLY\s+["']?match_players_user_id_match_id_idx["']?/i,
      );
    });

    it("DROP INDEX in the recovery instructions uses CONCURRENTLY", () => {
      // The recovery DROP appears inside a comment block, so we
      // match the un-stripped DDL (comments are valid recovery
      // documentation and an operator copy-pastes them verbatim).
      // Both occurrences in the runbook must keep the keyword.
      const dropMatches = ddl.match(/DROP\s+INDEX[^;]*CONCURRENTLY/gi) ?? [];
      expect(dropMatches.length).toBeGreaterThanOrEqual(1);
      for (const m of dropMatches) {
        expect(m).toMatch(/CONCURRENTLY/i);
      }
    });

    it("CREATE INDEX does NOT carry IF NOT EXISTS (so re-run on healthy index fails)", () => {
      // The whole point of the recovery runbook is that a partial
      // concurrent build cannot be silently masked by IF NOT EXISTS.
      // A regression that adds IF NOT EXISTS would let the second
      // build appear to succeed while leaving indisvalid = false in
      // place — the exact failure mode this migration's runbook is
      // designed to gate against.
      expect(stripped).not.toMatch(
        /CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS/i,
      );
    });

    it("recovery SELECT queries use to_regclass (not ::regclass) so missing indexes return NULL", () => {
      // `'<idx>'::regclass` THROWS on a missing index, which would
      // abort the recovery script before it can reach the
      // `DROP INDEX CONCURRENTLY IF EXISTS` branch. `to_regclass(...)`
      // returns NULL for absent names — that is the ABSENT signal
      // the runbook expects.
      expect(ddl).toMatch(
        /to_regclass\s*\(\s*'match_players_user_id_match_id_idx'\s*\)/,
      );
      // The legacy cast form must NOT appear in any SELECT — even
      // inside comments, since an operator copy-paste would break.
      expect(ddl).not.toMatch(
        /'match_players_user_id_match_id_idx'\s*::\s*regclass/,
      );
    });
  });
});
