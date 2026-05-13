import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    typecheck: {
      tsconfig: "./tsconfig.spec.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/*.spec.ts",
        "**/*.test.ts",
        "prisma/**",
      ],
    },
  },
});
