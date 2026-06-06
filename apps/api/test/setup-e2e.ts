// ============================================================
// E2E test environment guards.
//
// Fails fast if NODE_ENV is production or if DATABASE_URL is
// not pointing at the isolated test DB. This prevents a stray
// `pnpm test:e2e` from polluting the real dev database.
// ============================================================

const NODE_ENV = process.env.NODE_ENV ?? "development";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (NODE_ENV === "production") {
  throw new Error(
    "❌ E2E tests cannot run with NODE_ENV=production. Refusing to start.",
  );
}

const TEST_DB_HINTS = [":5434/", "/arena_test"];
const looksLikeTestDb = TEST_DB_HINTS.some((hint) =>
  DATABASE_URL.includes(hint),
);
if (!looksLikeTestDb) {
  throw new Error(
    "❌ E2E tests require DATABASE_URL pointing at the test DB " +
      "(port 5434 or db 'arena_test'). " +
      `Got: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`,
  );
}

// Test uses Redis DB index 1 to keep cache isolated from dev (DB 0).
if (!process.env.REDIS_URL?.includes("/1")) {
  console.warn(
    "⚠️  REDIS_URL does not target DB index 1; test runs may share " +
      "the dev cache namespace. Set REDIS_URL=redis://localhost:6379/1.",
  );
}
