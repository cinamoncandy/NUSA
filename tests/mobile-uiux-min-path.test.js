const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home keeps one actionable next step and truthful PAPER naming without the legacy dashboard", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /testID="home-next-action-button"/);
  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /PAPER · LIVE OFF/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /실제 가격 차트가 아님/);
  assert.equal((home.match(/testID="home-operational-notice"/g) || []).length, 1);
  assert.doesNotMatch(home, /<MetricTile/);
  assert.doesNotMatch(home, /PAPER 서버 연결이 필요합니다/);
  assert.doesNotMatch(home, /설정에서 연결/);
  assert.doesNotMatch(home, /<NusaButton|aiSignalEnd/);
  assert.doesNotMatch(home, /AI 신뢰도/);
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
  assert.match(home, /MotionReveal testID="home-hero-reveal"/);
  assert.match(chart, /MotionReveal testID="chart-data-reveal"/);
});

test("Chart preserves public/read-only and stale state semantics after hierarchy simplification", () => {
  const chart = read("src/chartView.tsx");
  assert.match(chart, /label=\{stale \? "STALE" : "READ ONLY"\}/);
  assert.match(chart, /accessibilityRole="text"/);
});
