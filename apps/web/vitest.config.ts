import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@arena/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@arena/game-core": path.resolve(
        __dirname,
        "../../packages/game-core/src",
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{spec,test}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    typecheck: {
      tsconfig: "./tsconfig.spec.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov", "html"],
      include: [
        "src/components/ui/app-shell-layout.tsx",
        "src/components/ui/sidebar.tsx",
      ],
      exclude: ["node_modules", ".next", "dist", "**/*.d.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
