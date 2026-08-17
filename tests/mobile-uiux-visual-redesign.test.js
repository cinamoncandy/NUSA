const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile", file), "utf8");

test("visual redesign has a distinct NUSA surface and financial hierarchy", () => {
  const classic = createTheme("dark", "classic");
  const master = createTheme("dark", "master");
  const primitives = read("src/uxPrimitives.tsx");

  assert.equal(classic.preset, "classic");
  assert.equal(master.preset, "master");
  assert.notEqual(master.colors.background, classic.colors.background);
  assert.notEqual(master.colors.surface, classic.colors.surface);
  assert.notEqual(master.colors.navSurface, classic.colors.navSurface);
  assert.notEqual(master.typography.hero, classic.typography.hero);
  assert.notEqual(master.typography.heading, classic.typography.heading);
  assert.notEqual(master.layout.screenPadding, classic.layout.screenPadding);
  assert.notEqual(master.layout.sectionGap, classic.layout.sectionGap);
  assert.equal(master.colors.chartUp, "#36D8CB");
  assert.match(primitives, /metricAccent: \{ position: "absolute", left: 14, right: 14/);
  assert.match(primitives, /borderRadius: 999, borderWidth: 1, gap: 3/);
});

test("Home uses one data-bound hero signal primitive", () => {
  const home = read("src/homeView.tsx");
  const components = read("src/components.tsx");
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /<TerrainSignal variant="symbolic" signalStrength=\{signalReady \? 0\.9 : 0\.35\} accessibilityLabel=/);
  assert.match(components, /accessibilityLabel=\{accessibilityLabel \?\? \(variant === "market" \? "실제 시장 데이터에 연결된 시그널" : "NUSA 상태 시그널"\)/);
});

test("Markets rows use list rhythm instead of repeated cards", () => {
  const watchlist = read("src/watchlistView.tsx");
  assert.match(watchlist, /marketRow: \{ borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.match(watchlist, /marketNumbers: \{ minWidth: 112/);
  assert.match(watchlist, /fontVariant: \["tabular-nums"\]/);
});

test("Chart prioritizes a wider plot and connects the signal only to real candles", () => {
  const chart = read("src/chartView.tsx");
  assert.match(chart, /plot: \{ height: 300/);
  assert.match(chart, /<TerrainSignal variant="market" signalStrength=\{Math\.min\(1, model\.candles\.length \/ 80\)\}/);
  assert.match(chart, /label=\{stale \? "STALE" : "READ ONLY"\}/);
});

test("Bottom navigation uses a restrained active rail without changing route contracts", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  assert.match(app, /backgroundColor: appTheme\.colors\.navSurface/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.aiSignalEnd/);
  assert.match(app, /const tabs = \["Home", "AiSignal", "Markets", "Paper", "Order", "Portfolio"\]/);
});

test("visual redesign keeps the authority boundary unchanged", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  const components = read("src/components.tsx");
  assert.match(app, /label="PAPER ONLY"/);
  assert.match(app, /label="LIVE NONE"/);
  assert.match(components, /ZERO AUTHORITY/);
  assert.doesNotMatch(read("src/upbitPublicQuotationClient.ts"), /Authorization|Access-Key|Secret-Key|JWT/);
});
