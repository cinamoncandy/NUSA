const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("primary PAPER never short-circuits into the legacy connection card or unified cockpit", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /activeTab === "Paper" \? <PaperLearningMonitorView/);
  assert.match(app, /onOpenSettings=\{goSettings\}/);
  assert.doesNotMatch(app, /function DashboardConnectionRequired/);
  assert.doesNotMatch(app, /requiresDashboardConnection/);
  assert.doesNotMatch(app, /activeTab === "Paper" \? <PaperShadowMonitorView/);
});

test("PAPER disconnected state stays inside the canonical cinematic monitor", () => {
  const paper = read("apps/mobile/src/paperLearningMonitorView.tsx");
  assert.match(paper, /CONNECTION STATE/);
  assert.match(paper, /testID="paper-open-settings"/);
  assert.match(paper, /variant="flow"/);
  assert.match(paper, /testID="paper-learning-monitor"/);
  assert.doesNotMatch(paper, /NusaCard/);
});

test("LIVE readiness no longer uses generic NusaCard surfaces", () => {
  const live = read("apps/mobile/src/liveReadinessMonitorView.tsx");
  assert.match(live, /function LiveSection/);
  assert.match(live, /variant="authority"/);
  assert.doesNotMatch(live, /NusaCard/);
});

test("Android visual acceptance requires canonical PAPER surface and rejects legacy replacement", () => {
  const workflow = read(".github/workflows/android-product-ux-acceptance.yml");
  assert.match(workflow, /grep -q "paper-learning-monitor" qa\/android-product-ux\/02-paper-primary\.xml/);
  assert.match(workflow, /! grep -q "dashboard-connection-required" qa\/android-product-ux\/02-paper-primary\.xml/);
});

test("shared Intelligence OS primitives do not reintroduce rounded finance-card surfaces", () => {
  const os = read("apps/mobile/src/intelligenceOs.tsx");
  assert.match(os, /metricStrip: \{ flexDirection: "row", borderTopWidth: StyleSheet\.hairlineWidth, borderBottomWidth: StyleSheet\.hairlineWidth \}/);
  assert.match(os, /notice: \{ borderLeftWidth: 2, borderTopWidth: StyleSheet\.hairlineWidth, borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.doesNotMatch(os, /metricStrip: \{[^\n]*borderRadius/);
  assert.doesNotMatch(os, /notice: \{[^\n]*borderRadius/);
});
