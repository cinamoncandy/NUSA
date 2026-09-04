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

test("Home uses the approved AI judgment plus one state-bound terrain primitive", () => {
  const home = read("src/homeView.tsx");
  const decisionSurface = read("src/homeDecisionSurface.ts");
  const components = read("src/components.tsx");

  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, />NUSA AI 판단<\/Text>/);
  assert.match(home, />신뢰도<\/Text>/);
  assert.match(home, /const terrainStrength = aiInsightAvailable \? 0\.95 : snapshot \? 0\.58 : 0\.34/);
  assert.match(home, /signalStrength=\{terrainStrength\}/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, />주요 지표<\/Text>/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);

  assert.doesNotMatch(home, /testID="home-supervisor-summary"/);
  assert.doesNotMatch(home, /testID="home-supervisor-result"/);
  assert.doesNotMatch(home, /const supervisorResult = decisionSurface\.result/);
  assert.doesNotMatch(home, /testID="home-paper-performance"/);
  assert.doesNotMatch(home, />TOTAL EQUITY</);
  assert.doesNotMatch(home, />CUMULATIVE PAPER P&L</);

  // The fail-closed decision projection remains valid for downstream consumers even though
  // the approved HOME presentation no longer renders the retired supervisor deck.
  assert.match(decisionSurface, /`PAPER P&L .* · EQUITY \$\{krw\(input\.paperEquity\)\}`/s);
  assert.match(components, /accessibilityLabel=\{accessibilityLabel \?\? \(variant === "market" \? "실제 시장 데이터에 연결된 시그널" : "NUSA 상태 시그널"\)/);
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
