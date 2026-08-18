const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "node tests/e2e/serve-components.js",
    url: "http://127.0.0.1:4173/component-preview.html",
    reuseExistingServer: false
  }
});
