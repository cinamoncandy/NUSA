import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.vitest.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["apps/**/*.js", "packages/**/*.js"],
      exclude: ["**/*.test.js", "tests/**", "dist/**", "coverage/**", "**/fixtures/**"]
    }
  }
});
