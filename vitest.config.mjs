import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.vitest.js", "apps/cloud/src/**/*.vitest.ts"]
  },
  coverage: {
    all: false,
    include: ["apps/desktop/renderer/**/*.js"],
    exclude: ["**/*.test.js", "tests/**", "node_modules/**"],
    // Floor gate: enforced only when coverage is explicitly enabled
    // (`vitest run --coverage`). Prevents silent zero-coverage regressions
    // without blocking the default `pnpm test:ui` run.
    thresholds: {
      lines: 50,
      functions: 50,
      branches: 40,
      statements: 50
    }
  }
});
