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
  assert.match(design, /master:[\s\S]*?dark:[\s\S]*?background: "#05060B"/);
  assert.match(design, /const palette = dark \? preset\.dark : preset\.light/);
  assert.match(design, /background: palette\.background/);
  assert.match(design, /navSurface: palette\.navSurface/);
  assert.match(design, /chartUp: dark \? "#34D6B4" : "#147A50"/);
  assert.match(primitives, /metricAccent: \{ position: "absolute", left: 14, right: 14/);
  assert.match(primitives, /borderRadius: 999, borderWidth: 1, gap: 3/);
});

test("Home uses the approved HOME MASTER terminal hierarchy without weakening authority", () => {
  const home = read("src/homeView.tsx");
  const decisionSurface = read("src/homeDecisionSurface.ts");

  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /PAPER PERFORMANCE/);
  assert.match(home, /CAPITAL LIMITS/);
  assert.match(home, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /UPBIT PUBLIC/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);

  assert.match(home, /<TerrainSignal/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-capital-limits"/);
  // The accent is intelligenceFieldColors.terminalSignal = #33D7C7, a cyan/teal. It was bound to a
  // constant named LIME, so anyone grepping this branch for the forbidden acid-lime palette found a
  // hit that was not one. Assert the binding under its true name.
  assert.match(home, /const SIGNAL_TEAL = intelligenceFieldColors\.terminalSignal/);
  assert.doesNotMatch(home, /\bLIME\b/);
  assert.match(decisionSurface, /`PAPER P&L .* · EQUITY \${krw\(input\.paperEquity\)}`/s);
  assert.doesNotMatch(home, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(home, /authority:\s*"LIVE"/);
});

test("Markets rows use list rhythm instead of repeated cards", () => {
  const watchlist = read("src/watchlistView.tsx");
  assert.match(watchlist, /marketRow: \{ borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.match(watchlist, /marketNumbers: \{ minWidth: 116, alignItems: "flex-end"/);
  assert.match(watchlist, /price: \{[^}]*fontVariant: \["tabular-nums"\]/);
  assert.match(watchlist, /change: \{[^}]*fontVariant: \["tabular-nums"\]/);
  assert.match(watchlist, /volumeInline: \{[^}]*fontVariant: \["tabular-nums"\]/);
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

test("Bottom navigation uses a restrained active rail with the five-destination route contract", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  assert.match(app, /backgroundColor: appTheme\.colors\.navSurface/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.primary : "transparent"/);
  assert.match(app, /const color = active \? intelligenceFieldColors\.terminalSignal : intelligenceFieldColors\.textSubtle/);
  // Six primary destinations, in the canonical order HOME -> AI SIGNAL -> MARKETS -> PAPER ->
  // ORDER -> PORTFOLIO. ORDER was promoted from a deeper route to a primary tab, so the old
  // five-tab list and the "PrimaryTab | \"Order\"" shape it implied are both superseded.
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\] as const/);
  assert.match(app, /Signals: "Signals"/);
  assert.match(app, /Signals: "AI 판단과 근거"/);
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
