const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("premium UI minimum path keeps canonical actionable Home routes and truthful PAPER naming", () => {
  const home = read("src/homeView.tsx");
  const decisionSurface = read("src/homeDecisionSurface.ts");
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /모의투자 전용 · 실거래 권한 없음 · AI 실행 권한 없음/);
  assert.match(decisionSurface, /const connectionRecoveryRequired = input\.disconnected \|\| input\.readOnlyError/);
  assert.match(decisionSurface, /const statusLabel = connectionRecoveryRequired[\s\S]*모의투자 · 복구 필요[\s\S]*input\.accountSource === "CLOUD"[\s\S]*모의투자 · \$\{[\s\S]*모의투자 · 기기 내[\s\S]*모의투자 · 연결 안 됨[\s\S]*모의투자 · 대기 중/);
  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"/);
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
