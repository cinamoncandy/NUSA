const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const brokerSource = readFileSync(join(process.cwd(), "packages/core/src/paperBroker.ts"), "utf8");
const html = readFileSync(join(process.cwd(), "apps/desktop/renderer/index.html"), "utf8");
const runtime = readFileSync(join(process.cwd(), "apps/desktop/renderer/app-runtime.js"), "utf8");

test("PaperBroker keeps execution-cost evidence on every paper order", () => {
  for (const field of ["spreadCost", "slippageCost", "marketImpactCost"]) {
    assert.match(brokerSource, new RegExp(`${field}: number`), `${field} must remain part of PaperOrder`);
    assert.match(brokerSource, new RegExp(`let ${field} =`), `${field} must be computed by PaperBroker`);
  }
  assert.match(brokerSource, /spreadCost,\s*slippageCost,\s*marketImpactCost/s);
});

test("canonical consumer renderer does not fabricate a retired execution-cost table", () => {
  assert.doesNotMatch(html, /체결비용/);
  assert.doesNotMatch(html, /id="fills"|data-fill-cost|data-execution-cost/);
  assert.doesNotMatch(runtime, /spreadCost|slippageCost|marketImpactCost/);
  assert.match(html, /최근 체결/);
  assert.match(html, /data-simple-order-list/);
});
