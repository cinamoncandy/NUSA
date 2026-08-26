const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Markets defaults to the chart and keeps it reachable even without real candle data", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §6): chart is the dominant/first region
  // -- it is not hidden behind the watchlist until real data exists. The segmented tabs are
  // always available; ChartView renders its own truthful unavailable state instead.
  assert.match(source, /useState<Panel>\("CHART"\)/);
  assert.doesNotMatch(source, /chartAvailable/);
  assert.match(source, /segment\("CHART",\s*"관찰 상세",\s*"markets-chart-tab"\)/);
  assert.match(source, /panel === "WATCHLIST"/);
  // Real candle wiring landed (see PR #526) -- the chart data source is no longer a placeholder gap.
  assert.match(app, /rawCandles=\{publicMarkets\.candles === null \? null : \[\.\.\.publicMarkets\.candles\]\}/);
});

test("Markets uses a simultaneous two-column workspace on tablets", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

  assert.match(source, /const tabletWorkspace = width >= 768/);
  assert.match(source, /testID="markets-tablet-workspace"/);
  assert.match(source, /testID="markets-tablet-watchlist"/);
  assert.match(source, /testID="markets-tablet-chart"/);
  assert.match(source, /tabletWorkspace: \{ flex: 1, flexDirection: "row"/);
  assert.match(source, /!tabletWorkspace \? \(panel === "WATCHLIST"/);
});

test("Markets reuses real watchlist ticker data for the chart's price move, not a new fetch", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  assert.match(source, /parseWatchlistMarkets/);
  assert.match(source, /changeRate=\{changeRate\}/);
  assert.doesNotMatch(source, /fetch\(|Math\.random/);
});
