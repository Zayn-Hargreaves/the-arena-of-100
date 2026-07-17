import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@arena/game-core": path.resolve(
        __dirname,
        "../../packages/game-core/src",
      ),
      "@arena/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    // Exclude integration specs: they require a real test database (via
    // setup-e2e helpers) and belong to the E2E runner (vitest-e2e.config.ts),
    // which is invoked separately in CI with the provisioned arena_test DB.
    // Including them here causes the standard test:coverage job to fail
    // when DATABASE_URL points at the main DB (port 5432, not 5434).
    exclude: ["node_modules/**", "dist/**", "**/*.integration.spec.ts"],
    typecheck: {
      tsconfig: "./tsconfig.spec.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.integration.spec.ts",
        "prisma/**",
        "src/main.ts",
        // Type-only declaration files (no runtime code, v8 reports 0%).
        "src/modules/match/game-loop.types.ts",
      ],
    },
  },
});
