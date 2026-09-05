const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile", file), "utf8");
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("visual redesign has a distinct NUSA surface and financial hierarchy", () => {
  const design = read("src/designSystem.ts");
  const primitives = read("src/uxPrimitives.tsx");
  assert.match(design, /classic:[\s\S]*?dark:[\s\S]*?background: "#05070D"/);
  assert.match(design, /master:[\s\S]*?dark:[\s\S]*?background: "#030607"/);
  assert.match(design, /const palette = dark \? preset\.dark : preset\.light/);
  assert.match(design, /background: palette\.background/);
  assert.match(design, /navSurface: palette\.navSurface/);
  assert.match(design, /chartUp: dark \? "#36D8CB" : "#147A50"/);
  assert.match(primitives, /metricAccent: \{ position: "absolute", left: 14, right: 14/);
  assert.match(primitives, /borderRadius: 999, borderWidth: 1, gap: 3/);
});

test("Home uses the approved Intelligence OS judgment, risk, observation, result, and learning hierarchy", () => {
  const home = read("src/homeView.tsx");
  const decisionSurface = read("src/homeDecisionSurface.ts");

  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /AUTONOMOUS INVESTMENT INTELLIGENCE · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /testID="home-now"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /kicker="WHY · AI INSIGHT"/);
  assert.match(home, /testID="home-risk-status"/);
  assert.match(home, /kicker="RISK STATUS"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /kicker="SIGNAL TERRAIN"/);
  assert.match(home, /PUBLIC READ ONLY/);
  assert.match(home, /시장 관찰은 전략 신호나 주문 권한으로 자동 승격되지 않습니다/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /kicker="PAPER PERFORMANCE"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /kicker="LEARNING"/);
  assert.match(home, /label="NOW"/);
  assert.match(home, /label="RESULT"/);
  assert.match(home, /label="RISK"/);
  assert.match(home, /label="LEARNING"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);

  assert.doesNotMatch(home, /<TerrainSignal/);
  assert.doesNotMatch(home, /testID="home-signal-trace"/);
  assert.doesNotMatch(home, /testID="home-market-pulse"/);
  assert.doesNotMatch(home, /testID="home-terminal-grid"/);

  assert.match(decisionSurface, /`PAPER P&L .* · EQUITY \$\{krw\(input\.paperEquity\)\}`/s);
});

test("Markets rows use list rhythm instead of repeated cards", () => {
  const watchlist = read("src/watchlistView.tsx");
  assert.match(watchlist, /marketRow: \{ borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.match(watchlist, /marketNumbers: \{ minWidth: 112/);
  assert.match(watchlist, /fontVariant: \["tabular-nums"\]/);
});

test("Chart prioritizes real candles and removes decorative market context", () => {
  const chart = read("src/chartView.tsx");
  assert.match(chart, /REAL CANDLES/);
  assert.match(chart, /<CandlePlot/);
  assert.match(chart, /label=\{stale \? "STALE" : "READ ONLY"\}/);
  assert.match(chart, /<NusaCard testID="chart-plot-card">[\s\S]*?REAL CANDLES[\s\S]*?<CandlePlot/);
  assert.doesNotMatch(chart, /<TerrainSignal/);
  assert.doesNotMatch(chart, /<MarketHeatmap/);
  assert.doesNotMatch(chart, /signal data:/);
});

test("Bottom navigation uses a restrained active rail without changing route contracts", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  assert.match(app, /backgroundColor: appTheme\.colors\.navSurface/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.aiSignalEnd/);
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\]/);
});

test("visual redesign keeps the authority boundary unchanged", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  const components = read("src/components.tsx");
  assert.match(app, /label="PAPER ONLY"/);
  assert.match(app, /label="LIVE NONE"/);
  assert.match(components, /ZERO AUTHORITY/);
  const quotationRuntime = withoutComments(read("src/upbitPublicQuotationClient.ts"));
  assert.doesNotMatch(quotationRuntime, /Authorization|Access-Key|Secret-Key|JWT/);
});
