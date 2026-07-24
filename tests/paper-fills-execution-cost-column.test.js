const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const html = readFileSync(join(process.cwd(), "apps/desktop/renderer/index.html"), "utf8");
const script = readFileSync(join(process.cwd(), "apps/desktop/renderer/renderer.js"), "utf8");

test("fills table exposes the execution-cost breakdown PaperBroker already computes per order", () => {
  assert.match(html, /체결비용/);
  assert.match(html, /<td colspan="6">체결 없음<\/td>/);
  assert.match(script, /cell\.colSpan = 6/);
  assert.match(script, /order\.spreadCost.*order\.slippageCost.*order\.marketImpactCost/s);
});
