const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile", file), "utf8");

test("visual redesign has a distinct NUSA surface and financial hierarchy", () => {
  const design = read("src/designSystem.ts");
  const primitives = read("src/uxPrimitives.tsx");
  assert.match(design, /background: dark \? "#05070D"/);
  assert.match(design, /navSurface: dark \? "#080D17"/);
  assert.match(design, /chartUp: dark \? "#48D6C0"/);
  assert.match(primitives, /metricAccent: \{ position: "absolute", left: 14, right: 14/);
  assert.match(primitives, /borderRadius: 999, borderWidth: 1, gap: 3/);
});

test("Home uses one data-bound hero terrain visual", () => {
  const home = read("src/homeView.tsx");
  const components = read("src/components.tsx");
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /<TerrainHero signalStrength=\{signalReady \? 0\.9 : 0\.35\} accessibilityLabel=/);
  assert.match(components, /accessibilityLabel=\{accessibilityLabel \?\? "NUSA 시장 지형 시각화"\}/);
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
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\]/);
});

test("visual redesign keeps the authority boundary unchanged", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
  const components = read("src/components.tsx");
  assert.match(app, /label="PAPER ONLY"/);
  assert.match(app, /label="LIVE NONE"/);
  assert.match(components, /ZERO AUTHORITY/);
  assert.doesNotMatch(read("src/upbitPublicQuotationClient.ts"), /Authorization|Access-Key|Secret-Key|JWT/);
});
