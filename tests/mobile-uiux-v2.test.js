const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product navigation promotes PAPER learning supervision and AI through the canonical five-tab shell", () => {
  const app = read("App.tsx");
  const home = read("src/homeView.tsx");
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\] as const/);
  assert.match(app, /Strategies: "Strategies"/);
  assert.match(app, /Signals: "Signals"/);
  assert.match(app, /Signals: "AI 판단과 근거"/);
  assert.match(app, /type Tab = PrimaryTab/);
  assert.match(app, /activeTab === "Signals" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /activeTab === "Strategies" \? <StrategiesView/);
  assert.match(app, /header-notifications/);
  assert.match(app, /header-settings/);
  assert.match(app, /setUtilityView\(null\); setActiveTab\(tab\)/);
  assert.match(app, /PaperLearningMonitorView/);
  assert.match(app, /buildPaperLearningScreen/);
  assert.match(app, /onOpenPaperLearning/);
  // The Android release contract requires a supervisor-learning role on HOME distinct from the
  // PAPER learning route. It had degenerated into a 1x1 opacity-0 node, so assert the surface as
  // well as the marker: it renders decision.learning, which is fail-closed, and is not hidden.
  assert.match(home, /testID="home-supervisor-learning"><Text style=\{styles\.supervisorLearning\}[^>]*>\{decision\.learning\}/);
  assert.doesNotMatch(home, /position:"absolute",width:1,height:1,opacity:0/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(read("src/portfolioView.tsx"), /testID="portfolio-paper-learning"/);
});

test("AI destination is evidence-backed and explicitly zero authority", () => {
  const source = read("src/aiView.tsx");
  assert.match(source, /ZERO AUTHORITY/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /ai\?\.evidenceReferences/);
  assert.match(source, /ai\?\.counterEvidence/);
  assert.match(source, /liveAuthority/);
  assert.match(source, /productionMutationAllowed/);
  assert.match(source, /AI ZERO AUTHORITY/);
  assert.doesNotMatch(source, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
});

test("Markets keeps the chart reachable and truthful even when App has no candle data", () => {
  const source = read("src/marketsView.tsx");
  const app = read("App.tsx");
  assert.match(source, /useState<Panel>\("CHART"\)/);
  assert.doesNotMatch(source, /chartAvailable/);
  assert.match(source, /panel === "WATCHLIST"/);
  assert.match(app, /rawCandles=\{publicMarkets\.candles === null \? null : \[\.\.\.publicMarkets\.candles\]\}/);
});

test("production PAPER exposes learning only while isolated legacy PAPER execution stays runtime-gated", () => {
  assert.match(read("src/localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
});

test("market discovery uses compact accessible favorite and sort controls", () => {
  const source = read("src/watchlistView.tsx");
  const primitives = read("src/uxPrimitives.tsx");
  assert.match(source, /accessibilityLabel=\{`\$\{market\.market\}/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /hitSlop=\{4\}/);
  assert.match(source, /favorite: \{ minWidth: 48, minHeight: 44/);
  assert.match(source, /<SegmentedControl/);
  assert.match(primitives, /segment: \{ flex: 1, minHeight: 44/);
  assert.doesNotMatch(source, /StatusChip label="READ ONLY"/);
  assert.doesNotMatch(source, /PUBLIC · READ ONLY/);
  assert.match(source, /active \? "저장됨" : "저장"/);
  assert.doesNotMatch(source, /★|☆/);
});
