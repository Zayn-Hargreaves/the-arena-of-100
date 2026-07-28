// ============================================================
// Plan A result validator.
//
// Reads raw JSONL artifacts produced by sample-monitoring.mjs +
// a k6 summary JSON, plus a `manifest.json` written by the
// workflow, and produces:
//   - <name>.report.json   structured pass/fail
//   - <name>.report.md     human-readable summary
//
// Implements the Pass/Fail criteria from Plan-A-k6-load-test.md.
//
// CLI usage:
//   node scripts/validate-results.mjs \
//     --manifest load-test/results/<name>.manifest.json \
//     --out-dir load-test/results
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseK6Metrics(m = {}) {
  let errorRate = null;
  let p95 = null;
  let p99 = null;
  let disconnectRate = null;

  if (m && typeof m === "object") {
    if (m.app_error_rate) {
      const obj = m.app_error_rate.values || m.app_error_rate;
      if (typeof obj.rate === "number") errorRate = obj.rate;
      else if (typeof obj.value === "number") errorRate = obj.value;
    }
    if (m.answer_result_latency_ms) {
      const obj = m.answer_result_latency_ms.values || m.answer_result_latency_ms;
      if (typeof obj["p(95)"] === "number") p95 = obj["p(95)"];
      if (typeof obj["p(99)"] === "number") p99 = obj["p(99)"];
    }
    if (m.ws_unexpected_disconnect && m.ws_connect_success) {
      const discObj = m.ws_unexpected_disconnect.values || m.ws_unexpected_disconnect;
      const okObj = m.ws_connect_success.values || m.ws_connect_success;
      const disc = typeof discObj.count === "number" ? discObj.count : (typeof discObj.value === "number" ? discObj.value : 0);
      const ok = typeof okObj.count === "number" ? okObj.count : (typeof okObj.value === "number" ? okObj.value : 0);
      disconnectRate = ok === 0 ? Infinity : disc / ok;
    }
  }

  return { errorRate, p95, p99, disconnectRate };
}

const isMain = Boolean(
  process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)),
);

if (isMain) {
  runValidationCli();
}

function runValidationCli() {
  const args = (() => {
    const out = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const k = process.argv[i];
      const v = process.argv[i + 1];
      if (!k || !k.startsWith("--")) continue;
      out[k.slice(2)] = v;
    }
    return out;
  })();

  const MANIFEST = args.manifest;
  if (!MANIFEST) {
    console.error("validate-results: --manifest <path> is required");
    process.exit(2);
  }
  const OUT_DIR = args["out-dir"] || path.dirname(MANIFEST);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const {
    name,
    scenario,
    thresholds = {},
    steadyState = {},
    expectedRedisKeys = null,
    k6Summary = null,
    cpuJsonl = null,
    redisJsonl = null,
    anchorJson = null,
    baselineRedisKeys = null,
  } = manifest;

  const errors = [];
  const checks = [];
  const ANCHOR_TOLERANCE_MS = 2000;

  function check(name, ok, detail) {
    checks.push({ name, ok, detail });
    if (!ok) errors.push(`${name}: ${detail}`);
  }

  function readJsonl(p) {
    if (!p || !fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }

  const cpu = readJsonl(cpuJsonl);
  const redis = readJsonl(redisJsonl);
  const anchors = anchorJson && fs.existsSync(anchorJson)
    ? JSON.parse(fs.readFileSync(anchorJson, "utf8"))
    : {};

  // ----- k6 summary metrics -----

  let errorRate = null;
  let p95 = null;
  let p99 = null;
  let disconnectRate = null;
  if (k6Summary && fs.existsSync(k6Summary)) {
    const sum = JSON.parse(fs.readFileSync(k6Summary, "utf8"));
    const m = sum.metrics || {};
    const parsed = parseK6Metrics(m);
    errorRate = parsed.errorRate;
    p95 = parsed.p95;
    p99 = parsed.p99;
    disconnectRate = parsed.disconnectRate;
  }

if (errorRate !== null) {
  check(
    "error_rate < 1%",
    errorRate < (thresholds.errorRateMax ?? 0.01),
    `errorRate=${errorRate.toFixed(4)} vs ${thresholds.errorRateMax ?? 0.01}`,
  );
} else {
  check("error_rate < 1%", false, "k6 summary missing app_error_rate");
}

if (p95 !== null) {
  check(
    "p95 latency < 1000ms",
    p95 < (thresholds.latencyP95Ms ?? 1000),
    `p95=${p95.toFixed(1)}ms vs ${thresholds.latencyP95Ms ?? 1000}ms`,
  );
} else {
  check("p95 latency < 1000ms", false, "k6 summary missing p95");
}

if (p99 !== null) {
  check(
    "p99 latency < 2500ms",
    p99 < (thresholds.latencyP99Ms ?? 2500),
    `p99=${p99.toFixed(1)}ms vs ${thresholds.latencyP99Ms ?? 2500}ms`,
  );
} else {
  check("p99 latency < 2500ms", false, "k6 summary missing p99");
}

if (disconnectRate !== null) {
  const limit = thresholds.disconnectMax ?? 0.01;
  const ok = disconnectRate < limit;
  check(
    "disconnect rate < 1%",
    ok,
    `disconnectRate=${Number.isFinite(disconnectRate) ? disconnectRate.toFixed(4) : "N/A"} vs ${limit}`,
  );
} else {
  check("disconnect rate < 1%", false, "k6 summary missing disconnect metrics");
}

// ----- readiness barrier -----
// Fail-closed: every readiness field must be present, size must
// equal target, missing list must be empty, achievedAt must be
// within the 2 * HOLD deadline.

const readiness = manifest.readiness || null;
if (!readiness) {
  check("readiness barrier met", false, "no readiness record in manifest");
} else {
  const fields = ["ready", "size", "target", "achievedAt", "deadlineAt", "missing"];
  const missingFields = fields.filter((f) => readiness[f] === undefined || readiness[f] === null);
  if (missingFields.length > 0) {
    check(
      "readiness barrier met",
      false,
      `readiness metadata missing fields: ${missingFields.join(",")}`,
    );
  } else if (readiness.ready !== true) {
    check(
      "readiness barrier met",
      false,
      `Set.size=${readiness.size} < ${readiness.target}; missing=${(readiness.missing || []).slice(0, 5).join(",")}${readiness.missing?.length > 5 ? "..." : ""}`,
    );
  } else if (readiness.size !== readiness.target) {
    check(
      "readiness barrier met",
      false,
      `size=${readiness.size} != target=${readiness.target}`,
    );
  } else if (!Array.isArray(readiness.missing) || readiness.missing.length !== 0) {
    check(
      "readiness barrier met",
      false,
      `readiness.missing must be empty when ready, got ${JSON.stringify(readiness.missing)}`,
    );
  } else {
    const achieved = new Date(readiness.achievedAt).getTime();
    const deadline = new Date(readiness.deadlineAt).getTime();
    if (!Number.isFinite(achieved) || !Number.isFinite(deadline)) {
      check(
        "readiness barrier met",
        false,
        `achievedAt/deadlineAt must be valid ISO timestamps (got ${readiness.achievedAt} / ${readiness.deadlineAt})`,
      );
    } else if (achieved > deadline) {
      check(
        "readiness barrier met",
        false,
        `achievedAt=${readiness.achievedAt} > deadlineAt=${readiness.deadlineAt} (> 2*HOLD)`,
      );
    } else {
      check(
        "readiness barrier met",
        true,
        `ready at ${readiness.achievedAt} (size=${readiness.size}/${readiness.target}, deadline=${readiness.deadlineAt})`,
      );
    }
  }
}

// ----- CPU / RSS -----
// Fail-closed: require startTs/endTs to be present and valid,
// require the actual duration to meet HOLD_MIN, and require
// N_MIN valid steady-state samples.

const steadyMin = (steadyState && steadyState.holdMinSeconds) || 30;
const N_MIN = Math.max(20, Math.ceil(steadyMin));

const rawStart = steadyState && steadyState.startTs;
const rawEnd = steadyState && steadyState.endTs;
const steadyStart = rawStart ? new Date(rawStart).getTime() : null;
const steadyEnd = rawEnd ? new Date(rawEnd).getTime() : null;

if (!Number.isFinite(steadyStart)) {
  check("steady-state window defined", false, "manifest.steadyState.startTs missing or invalid");
}
if (!Number.isFinite(steadyEnd)) {
  check("steady-state window defined", false, "manifest.steadyState.endTs missing or invalid");
}
if (Number.isFinite(steadyStart) && Number.isFinite(steadyEnd) && steadyEnd <= steadyStart) {
  check(
    "steady-state window defined",
    false,
    `endTs (${rawEnd}) must be after startTs (${rawStart})`,
  );
}

const cpuSteady = (Number.isFinite(steadyStart) && Number.isFinite(steadyEnd))
  ? cpu.filter((s) => {
      const t = new Date(s.ts).getTime();
      return Number.isFinite(t) && t >= steadyStart && t < steadyEnd;
    })
  : [];

// Pre-baseline samples: any sample that arrived before the steady
// window can have cpu === null (no delta yet). After we have at
// least one valid CPU sample inside steady-state, every subsequent
// steady-state sample MUST have a numeric cpu value.
const cpuValues = [];
const rssValues = [];
let invalidCpuCount = 0;
let invalidRssCount = 0;
let erroredSampleCount = 0;
let sawFirstValidCpu = false;

for (const s of cpuSteady) {
  if (s.error) erroredSampleCount += 1;
  if (isFiniteNumber(s.cpu)) {
    cpuValues.push(s.cpu);
    sawFirstValidCpu = true;
  } else if (sawFirstValidCpu) {
    invalidCpuCount += 1;
  }
  if (isFiniteNumber(s.rssBytes)) {
    rssValues.push(s.rssBytes);
  } else {
    invalidRssCount += 1;
  }
}

cpuValues.sort((a, b) => a - b);
const cpuPeak = cpuValues.length > 0 ? cpuValues[cpuValues.length - 1] : null;
const cpuP95 = quantile(cpuValues, 0.95);
const rssPeak = rssValues.length > 0 ? Math.max(...rssValues) : null;

if (Number.isFinite(steadyStart) && Number.isFinite(steadyEnd)) {
  const actualDurationSec = (steadyEnd - steadyStart) / 1000;
  check(
    "steady-state duration >= HOLD_MIN",
    actualDurationSec >= steadyMin,
    `actual=${actualDurationSec.toFixed(1)}s >= HOLD_MIN=${steadyMin}s (start=${rawStart} end=${rawEnd})`,
  );
}

if (invalidCpuCount > 0) {
  check(
    "cpu samples valid (no null after first valid sample)",
    false,
    `invalidCpuCount=${invalidCpuCount} / steady=${cpuSteady.length}`,
  );
} else {
  check(
    "cpu samples valid (no null after first valid sample)",
    true,
    `n=${cpuValues.length}`,
  );
}

if (invalidRssCount > 0) {
  check(
    "rss samples present",
    false,
    `invalidRssCount=${invalidRssCount} / steady=${cpuSteady.length}`,
  );
}

if (erroredSampleCount > 0) {
  check(
    "cpu sampler errors in steady-state",
    false,
    `erroredSampleCount=${erroredSampleCount} / steady=${cpuSteady.length}`,
  );
}

if (cpuSteady.length < N_MIN) {
  check(
    "n_steady >= N_MIN",
    false,
    `n_steady_cpu=${cpuSteady.length} < N_MIN=${N_MIN} (HOLD_MIN=${steadyMin}s)`,
  );
} else {
  check(
    "n_steady >= N_MIN",
    true,
    `n_steady_cpu=${cpuSteady.length} >= N_MIN=${N_MIN}`,
  );
}

if (cpuPeak !== null) {
  check(
    "cpu peak <= 80% (steady-state)",
    cpuPeak <= (thresholds.cpuPeakMax ?? 80),
    `peak=${cpuPeak.toFixed(2)}% n=${cpuValues.length}`,
  );
} else {
  check("cpu peak <= 80% (steady-state)", false, "no valid CPU samples in steady-state");
}

if (cpuP95 !== null) {
  check(
    "cpu p95 <= 70% (steady-state)",
    cpuP95 <= (thresholds.cpuP95Max ?? 70),
    `p95=${cpuP95.toFixed(2)}% n=${cpuValues.length}`,
  );
} else {
  check("cpu p95 <= 70% (steady-state)", false, "no valid CPU samples in steady-state");
}

if (rssPeak !== null) {
  const rssPeakMb = rssPeak / (1024 * 1024);
  check(
    "rss peak <= 500 MB (steady-state)",
    rssPeakMb <= (thresholds.rssPeakMaxMb ?? 500),
    `peak=${rssPeakMb.toFixed(1)}MB n=${rssValues.length}`,
  );
} else {
  check("rss peak <= 500 MB (steady-state)", false, "no valid RSS samples in steady-state");
}

function findNearestSample(samples, anchorTs) {
  if (!anchorTs || samples.length === 0) return null;
  const target = new Date(anchorTs).getTime();
  if (!Number.isFinite(target)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const s of samples) {
    const t = new Date(s.ts).getTime();
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  if (bestDelta > ANCHOR_TOLERANCE_MS) return null;
  return best;
}

// RSS delta across cleanup window (anchors: cleanup_window_start / cleanup_window_end)
const cleanupStart = anchors.cleanup_window_start
  ? findNearestSample(cpu, anchors.cleanup_window_start.ts)
  : null;
const cleanupEnd = anchors.cleanup_window_end
  ? findNearestSample(cpu, anchors.cleanup_window_end.ts)
  : null;

if (cleanupStart && cleanupEnd) {
  const delta = cleanupEnd.rssBytes - cleanupStart.rssBytes;
  const deltaMb = delta / (1024 * 1024);
  check(
    "rss delta cleanup <= +50 MB",
    deltaMb <= (thresholds.rssDeltaMaxMb ?? 50),
    `delta=${deltaMb.toFixed(1)}MB (start=${cleanupStart.rssBytes}B end=${cleanupEnd.rssBytes}B)`,
  );
} else {
  check(
    "rss delta cleanup <= +50 MB",
    false,
    "anchor samples for cleanup_window_start/end missing",
  );
}

// ----- Redis -----

const redisSteady = (Number.isFinite(steadyStart) && Number.isFinite(steadyEnd))
  ? redis.filter((s) => {
      const t = new Date(s.ts).getTime();
      return Number.isFinite(t) && t >= steadyStart && t < steadyEnd;
    })
  : [];

// expectedRedisKeys is mandatory: the Plan A gate only makes sense
// when we know what to expect. Missing the field is a hard fail
// (previous behaviour silently passed the gate).
if (expectedRedisKeys === null) {
  check(
    "redis match:state:* count steady-state (gate defined)",
    false,
    "expectedRedisKeys is missing from manifest; cannot enforce Plan A gate",
  );
} else {
  const redisCountOk = redisSteady.length >= N_MIN;
  if (!redisCountOk) {
    check(
      "redis n_steady >= N_MIN",
      false,
      `n_steady_redis=${redisSteady.length} < N_MIN=${N_MIN} (HOLD_MIN=${steadyMin}s)`,
    );
  } else {
    check(
      "redis n_steady >= N_MIN",
      true,
      `n_steady_redis=${redisSteady.length} >= N_MIN=${N_MIN}`,
    );

    const missing = [];
    const wrongCount = [];
    for (const s of redisSteady) {
      if (!isFiniteNumber(s.keyCount)) {
        missing.push(s);
        continue;
      }
      if (s.keyCount !== expectedRedisKeys) {
        wrongCount.push(s);
      }
    }
    const offendingCount = missing.length + wrongCount.length;
    const detail =
      `offending=${offendingCount} (missing=${missing.length}, wrong=${wrongCount.length}) ` +
      `/ total=${redisSteady.length} (expected=${expectedRedisKeys})`;
    check(
      `redis match:state:* count == ${expectedRedisKeys} (steady-state, every sample)`,
      offendingCount === 0,
      detail,
    );
  }
}

// Cleanup window: 3 samples closest to cleanup_window_end within
// the cleanup window, keyCount must be 0 OR equal to the configured
// pre-run baseline (baselineRedisKeys). Anchor tolerance is the
// same ±2s used elsewhere.
if (!anchors.cleanup_window_end) {
  check(
    "redis match:state:* count cleanup (3 samples near anchor == 0 or baseline)",
    false,
    "anchor cleanup_window_end missing",
  );
} else {
  const endTs = new Date(anchors.cleanup_window_end.ts).getTime();
  const startTs = anchors.cleanup_window_start
    ? new Date(anchors.cleanup_window_start.ts).getTime()
    : null;
  const window = redis.filter((s) => {
    const t = new Date(s.ts).getTime();
    if (!Number.isFinite(t)) return false;
    if (t > endTs + ANCHOR_TOLERANCE_MS) return false;
    if (startTs !== null && t < startTs - ANCHOR_TOLERANCE_MS) return false;
    return true;
  });
  // Pick the 3 samples closest to the cleanup_window_end anchor.
  const sortedByProximity = window
    .map((s) => ({ s, d: Math.abs(new Date(s.ts).getTime() - endTs) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.s);
  const acceptable = new Set([0]);
  if (isFiniteNumber(baselineRedisKeys)) acceptable.add(baselineRedisKeys);
  const allOk =
    sortedByProximity.length === 3 &&
    sortedByProximity.every(
      (s) => isFiniteNumber(s.keyCount) && acceptable.has(s.keyCount),
    );
  check(
    "redis match:state:* count cleanup (3 samples near anchor == 0 or baseline)",
    allOk,
    `samples=${sortedByProximity.length}, counts=${sortedByProximity.map((s) => s.keyCount).join(",")}, baseline=${isFiniteNumber(baselineRedisKeys) ? baselineRedisKeys : "n/a"}`,
  );
}

// Redis memory delta across pre_run_baseline -> cleanup_window_end
const baselineAnchor = anchors.pre_run_baseline
  ? findNearestSample(redis, anchors.pre_run_baseline.ts)
  : null;
const cleanupRedisAnchor = anchors.cleanup_window_end
  ? findNearestSample(redis, anchors.cleanup_window_end.ts)
  : null;
if (baselineAnchor && cleanupRedisAnchor) {
  const base = baselineAnchor.usedMemoryBytes;
  const end = cleanupRedisAnchor.usedMemoryBytes;
  if (isFiniteNumber(base) && isFiniteNumber(end) && base > 0) {
    const deltaPct = ((end - base) / base) * 100;
    check(
      "redis memory delta <= +10%",
      deltaPct <= (thresholds.redisMemDeltaMaxPct ?? 10),
      `delta=${deltaPct.toFixed(2)}% (base=${base}B end=${end}B)`,
    );
  } else {
    check("redis memory delta <= +10%", false, "missing usedMemoryBytes in anchors");
  }
} else {
  check(
    "redis memory delta <= +10%",
    false,
    "anchor samples for pre_run_baseline/cleanup_window_end missing",
  );
}

// ----- output -----

const summary = {
  name,
  scenario,
  overallPass: errors.length === 0,
  failed: errors.length,
  total: checks.length,
  metrics: {
    errorRate,
    p95,
    p99,
    disconnectRate: disconnectRate === Infinity ? "Infinity" : disconnectRate,
    cpuPeak,
    cpuP95,
    rssPeakBytes: rssPeak,
    n_steady_cpu: cpuSteady.length,
    n_steady_cpu_valid: cpuValues.length,
    n_steady_redis: redisSteady.length,
    N_MIN,
    holdMinSeconds: steadyMin,
  },
  // Actual samples selected by findNearestSample() so the report
  // is fully traceable back to a raw artifact line.
  anchorsUsed: {
    cleanupStart: cleanupStart
      ? { ts: cleanupStart.ts, rssBytes: cleanupStart.rssBytes }
      : null,
    cleanupEnd: cleanupEnd
      ? { ts: cleanupEnd.ts, rssBytes: cleanupEnd.rssBytes }
      : null,
    baselineAnchor: baselineAnchor
      ? { ts: baselineAnchor.ts, usedMemoryBytes: baselineAnchor.usedMemoryBytes }
      : null,
    cleanupRedisAnchor: cleanupRedisAnchor
      ? { ts: cleanupRedisAnchor.ts, usedMemoryBytes: cleanupRedisAnchor.usedMemoryBytes }
      : null,
  },
  checks,
  anchors,
  artifacts: {
    cpuJsonl,
    redisJsonl,
    k6Summary,
    anchorJson,
  },
  manifest: MANIFEST,
};

fs.writeFileSync(
  path.join(OUT_DIR, `${name}.report.json`),
  JSON.stringify(summary, null, 2),
);

const lines = [];
lines.push(`# Plan A — ${scenario} run report`);
lines.push("");
lines.push(`- Overall: **${summary.overallPass ? "ĐẠT" : "KHÔNG ĐẠT"}** (${checks.length - errors.length}/${checks.length} pass)`);
lines.push(`- Run name: \`${name}\``);
if (k6Summary) lines.push(`- k6 summary: \`${k6Summary}\``);
if (cpuJsonl) lines.push(`- CPU JSONL: \`${cpuJsonl}\``);
if (redisJsonl) lines.push(`- Redis JSONL: \`${redisJsonl}\``);
lines.push("");
lines.push("## Metrics");
lines.push("");
lines.push(`- error rate: ${fmt(errorRate)} (target < ${thresholds.errorRateMax ?? 0.01})`);
lines.push(`- p95 latency: ${fmt(p95)} ms (target < ${thresholds.latencyP95Ms ?? 1000} ms)`);
lines.push(`- p99 latency: ${fmt(p99)} ms (target < ${thresholds.latencyP99Ms ?? 2500} ms)`);
lines.push(`- disconnect rate: ${fmt(disconnectRate)} (target < ${thresholds.disconnectMax ?? 0.01})`);
lines.push(`- CPU peak (steady-state, % of 1 core): ${fmt(cpuPeak)} (target ≤ ${thresholds.cpuPeakMax ?? 80})`);
lines.push(`- CPU p95 (steady-state, % of 1 core): ${fmt(cpuP95)} (target ≤ ${thresholds.cpuP95Max ?? 70})`);
lines.push(`- RSS peak: ${rssPeak != null ? (rssPeak / (1024 * 1024)).toFixed(1) + " MB" : "n/a"} (target ≤ ${thresholds.rssPeakMaxMb ?? 500} MB)`);
lines.push(`- n_steady_cpu=${summary.metrics.n_steady_cpu} (valid=${summary.metrics.n_steady_cpu_valid}, N_MIN=${N_MIN}), n_steady_redis=${summary.metrics.n_steady_redis}`);
lines.push("");
lines.push("## Anchors used");
lines.push("");
lines.push(`- cleanupStart: ${fmtAnchor(summary.anchorsUsed.cleanupStart)}`);
lines.push(`- cleanupEnd: ${fmtAnchor(summary.anchorsUsed.cleanupEnd)}`);
lines.push(`- baselineAnchor (Redis): ${fmtAnchor(summary.anchorsUsed.baselineAnchor)}`);
lines.push(`- cleanupRedisAnchor (Redis): ${fmtAnchor(summary.anchorsUsed.cleanupRedisAnchor)}`);
lines.push("");
lines.push("## Checks");
lines.push("");
for (const c of checks) {
  lines.push(`- ${c.ok ? "PASS" : "FAIL"} — ${c.name} — ${c.detail}`);
}
if (errors.length > 0) {
  lines.push("");
  lines.push("## Failing items");
  for (const e of errors) lines.push(`- ${e}`);
}

fs.writeFileSync(path.join(OUT_DIR, `${name}.report.md`), lines.join("\n"));

console.log(`[validator] ${summary.overallPass ? "PASS" : "FAIL"} — wrote ${name}.report.{json,md}`);
process.exit(summary.overallPass ? 0 : 1);

function fmt(v) {
  if (v == null) return "n/a";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "n/a";
    return v.toFixed(3);
  }
  return String(v);
}

function fmtAnchor(a) {
  if (!a) return "n/a";
  return `ts=${a.ts}, value=${fmt(Object.values(a).find((v) => typeof v === "number"))}`;
}
}

