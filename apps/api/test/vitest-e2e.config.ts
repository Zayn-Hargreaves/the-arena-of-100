// ============================================================
// E2E test config (Vitest)
//
// Extends the default Vitest config with a separate test file
// pattern, decorator-metadata support (so NestJS DI works), and
// an isolated cache dir so unit and E2E suites never step on
// each other.
// ============================================================

import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "path";

const isCi = process.env.CI === "true";

export default defineConfig({
  resolve: {
    alias: {
      "@arena/game-core": path.resolve(
        __dirname,
        "../../../packages/game-core/src",
      ),
      "@arena/shared": path.resolve(__dirname, "../../../packages/shared/src"),
    },
  },
  plugins: [
    // SWC transpiler preserves decorator metadata (esbuild's
    // esbuild plugin does not emit design:paramtypes by default,
    // which breaks NestJS constructor-parameter DI in tests).
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
  cacheDir: ".vitest/e2e",
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.e2e-spec.ts"],
    exclude: ["node_modules", "dist", "src/**"],
    reporters: isCi ? ["default", "junit", "json"] : undefined,
    outputFile: isCi
      ? {
          junit: "./test-results/e2e-junit.xml",
          json: "./test-results/e2e-report.json",
        }
      : undefined,
    // Serial execution is required today: every spec shares the
    // same test PostgreSQL + Redis DB index 1. The safe parallel
    // strategies (per-worker DB names, transactional rollback,
    // testcontainers) are deferred to a follow-up PR — see the
    // TODO below.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    // TODO(e2e-parallel): pick one of
    //   (a) per-worker DB naming (globalSetup + worker-id env),
    //   (b) beforeEach transaction + afterEach rollback,
    //   (c) testcontainers per worker,
    // then flip `singleFork: false` + `fileParallelism: true`.
  },
});
