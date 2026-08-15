const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile", file), "utf8");

test("AI tab shows a TerrainHero driven by real (or deliberately modest default) confidence", () => {
  const source = read("src/aiView.tsx");
  assert.match(source, /<TerrainHero signalStrength=\{signalStrength\}/);
  assert.match(source, /const signalStrength = ai\?\.calibrationStatus === "CALIBRATED" \? ai\.confidence : 0\.3;/);
  assert.match(source, /testID="ai-signal-terrain"/);
});

test("Markets shows a real change-rate breadth bar, not a modeled risk label", () => {
  const source = read("src/marketsView.tsx");
  assert.match(source, /computeMarketBreadth/);
  assert.match(source, /testID="markets-breadth"/);
  assert.doesNotMatch(source, /RISK ZONE|OPPORTUNITY ZONE/);
});
