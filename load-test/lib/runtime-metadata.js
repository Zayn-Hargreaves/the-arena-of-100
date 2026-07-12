// ============================================================
// Runtime metadata helpers — shared by the k6 harness, the
// monitoring sampler, and the post-run validator.
//
// All read-only: pulls values from the same env the API uses and
// never logs the raw REDIS_URL (Plan A redaction rule).
// ============================================================

// Parse a redis://[user:pass@]host:port[/db] URL into redacted
// parts. `userinfo` is intentionally NOT returned — it must never
// be logged or written into a raw artifact.
export function parseRedisUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { scheme: null, host: null, port: null, db: null, tls: false };
  }

  const match = rawUrl.match(
    /^(rediss?):\/\/(?:[^@/]+@)?([^:/]+)(?::(\d+))?(?:\/(\d+))?/i,
  );
  if (!match) {
    return { scheme: null, host: null, port: null, db: null, tls: false };
  }

  const scheme = match[1].toLowerCase();
  const portRaw = match[3] ? Number.parseInt(match[3], 10) : null;
  const tls = scheme === "rediss" || (portRaw !== null && portRaw === 6380);
  const dbRaw = match[4] !== undefined ? Number.parseInt(match[4], 10) : null;
  // Per plan: do NOT default to a non-zero DB. If the URL omits /db,
  // surface that explicitly as null so a sampler can fail fast.
  const db = Number.isFinite(dbRaw) ? dbRaw : null;

  return {
    scheme,
    host: match[2],
    port: portRaw,
    db,
    tls,
  };
}

// Build a redacted URL string suitable for raw-artifact logging.
// NEVER include userinfo. Example:
//   redis://10.0.0.1:6379/2
export function redactedRedisUrl(parts) {
  if (!parts || !parts.scheme || !parts.host) return null;
  const port = parts.port ? `:${parts.port}` : "";
  const db = parts.db != null ? `/${parts.db}` : "";
  return `${parts.scheme}://${parts.host}${port}${db}`;
}

export function resolveRedisTarget() {
  const url = __ENV.REDIS_URL || "redis://localhost:6379";
  const keyPrefix = __ENV.REDIS_KEY_PREFIX || "";
  const parts = parseRedisUrl(url);
  const pattern = `${keyPrefix ? keyPrefix + ":" : ""}match:state:*`;
  return {
    ...parts,
    keyPrefix,
    pattern,
    redactedUrl: redactedRedisUrl(parts),
  };
}

// Resolve the admin JWT for the in-process sampler (Node). The
// sampler runs outside k6, so it can't reuse the harness helpers.
export function loadAdminJwtConfig() {
  return {
    apiUrl: __ENV.API_URL || "http://localhost:3001",
    jwtSecret: __ENV.JWT_SECRET || "arena-100-secret-key",
    // Username seeded by prisma/seed.ts. Kept as a constant so the
    // sampler never assumes a value the API hasn't actually seeded.
    adminUsername: __ENV.LOAD_TEST_ADMIN_USERNAME || "admin",
  };
}
