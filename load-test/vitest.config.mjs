import { defineConfig } from "vitest/config";

// Standalone vitest project for the load-test harness's pure Node modules
// (reconnect state machine, failover verdict). These are deliberately NOT
// part of the k6 runtime and NOT a pnpm workspace package, so they run via:
//   node_modules/.bin/vitest run --config load-test/vitest.config.mjs
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
    environment: "node",
  },
});
