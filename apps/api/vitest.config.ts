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
        "prisma/**",
        "src/main.ts",
        // Type-only declaration files (no runtime code, v8 reports 0%).
        "src/modules/match/game-loop.types.ts",
      ],
    },
  },
});
