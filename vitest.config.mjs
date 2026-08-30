import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.vitest.js", "apps/cloud/src/**/*.test.ts"]
  },
  coverage: {
    all: false,
    include: ["apps/desktop/renderer/**/*.js"],
    exclude: ["**/*.test.js", "tests/**", "node_modules/**"]
  }
});
