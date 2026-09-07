const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");
const { buildChartViewModel } = require("../dist/apps/mobile/src/chartViewModel.js");

const input = { market: "KRW-BTC", interval: "1m", rawCandles: [{ market: "KRW-BTC", openTime: 60000, closeTime: 120000, open: 100, high: 104, low: 99, close: 102, volume: 1 }], currentPrice: 102, connectionState: "CONNECTED", stale: false };

test("approved porcelain/cobalt theme preserves semantic authority and accessible targets", () => {
  assert.equal(createTheme("light").colors.background, "#F4F5F8");
  assert.equal(createTheme("light").colors.primary, "#304EE8");
  for (const mode of ["light", "dark"]) {
    const t = createTheme(mode);
    assert.equal(t.radii.lg, 22);
    assert.ok(t.interaction.touchTarget >= 48);
    assert.notEqual(t.colors.danger, t.colors.primary);
    assert.notEqual(t.colors.success, t.colors.primary);
  }
});

test("Home reuses canonical chart reader and renderer without sample or private IO", () => {
  const home = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
  assert.match(home, /buildChartViewModel\(\{ market: publicMarket/);
  assert.match(home, /stale: publicMarketStale/);
  assert.match(home, /marketChart.state === "READY" \? <CandlePlot model=\{marketChart\}/);
  assert.match(home, /krw\(marketChart.currentPrice\)/);
  assert.doesNotMatch(home, /128420000|128,420,000|Math.random|fetch\(|WebSocket/);
  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /disabled=\{disconnected\}/);
  assert.match(home, /LIVE NONE · AI ZERO AUTHORITY/);
});

test("Home chart input remains unavailable on stale, disconnected, missing or malformed evidence", () => {
  assert.equal(buildChartViewModel(input).state, "READY");
  for (const override of [{ stale: true }, { connectionState: "OFFLINE" }, { rawCandles: null }, { rawCandles: [] }, { currentPrice: NaN }, { rawCandles: [{ ...input.rawCandles[0], market: "KRW-ETH" }] }]) {
    const model = buildChartViewModel({ ...input, ...override });
    assert.notEqual(model.state, "READY");
    assert.equal(model.currentPrice, null);
    assert.deepEqual(model.bars, []);
  }
});
