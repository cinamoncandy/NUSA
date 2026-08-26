const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("premium UI minimum path keeps one actionable Home next step and truthful PAPER naming", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /testID="home-supervisor-primary-action"/);
  assert.match(home, /<CompactMetric label="PAPER 연결"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /const statusLabel = snapshot[\s\S]*PAPER · \$\{runtimeState[\s\S]*PAPER · OFFLINE[\s\S]*PAPER · STANDBY/);
  assert.match(home, /<QuietStatus label=\{statusLabel\} tone=\{statusTone\} testID="home-paper-status" \/>/);
  assert.match(home, /accessibilityLabel=\{terrainLabel\}/);
  assert.doesNotMatch(home, /<MetricTile label="PAPER 연결"/);
  assert.doesNotMatch(home, /primaryActions/);
});

test("functional motion is bounded and reduced-motion aware", () => {
  const components = read("src/components.tsx");
  const home = read("src/homeView.tsx");
  const chart = read("src/chartView.tsx");
  assert.match(components, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(components, /reduceMotionChanged/);
  assert.match(components, /Animated\.timing/);
  assert.match(components, /useNativeDriver: true/);
  assert.doesNotMatch(home, /MotionReveal testID="home-hero-reveal"/);
  assert.match(chart, /MotionReveal testID="chart-data-reveal"/);
});

test("Chart preserves public/read-only and stale state semantics after hierarchy simplification", () => {
  const chart = read("src/chartView.tsx");
  assert.match(chart, /label=\{stale \? "STALE" : "READ ONLY"\}/);
  assert.match(chart, /accessibilityRole="text"/);
});
