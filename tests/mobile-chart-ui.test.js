const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { aggregatePublicCandles, buildChartViewModel, parsePublicCandles } = require("../dist/apps/mobile/src/chartViewModel.js");

function candles(count = 10) {
  return Array.from({ length: count }, (_, index) => {
    const openTime = index * 60_000;
    const open = 100 + index;
    const close = open + (index % 2 === 0 ? 2 : -1);
    return { market: "KRW-BTC", candle_date_time_utc: new Date(openTime).toISOString().replace(".000Z", ""), opening_price: open, high_price: Math.max(open, close) + 2, low_price: Math.min(open, close) - 2, trade_price: close, candle_acc_trade_volume: index + 1, source: "UPBIT_PUBLIC_CANDLE" };
  });
}

test("public candle parser validates Upbit OHLCV and aggregates complete intervals", () => {
  const parsed = parsePublicCandles(candles(), "KRW-BTC");
  assert.equal(parsed.length, 10);
  const fiveMinute = aggregatePublicCandles(parsed, "5m");
  assert.equal(fiveMinute.length, 2);
  assert.equal(fiveMinute[0].open, 100);
  assert.equal(fiveMinute[0].closeTime, 300_000);
  assert.equal(fiveMinute[0].volume, 15);
});

test("chart parser rejects non-public, malformed, and non-contiguous data", () => {
  assert.throws(() => parsePublicCandles(candles().map((item, index) => index === 2 ? { ...item, source: "UPBIT_PUBLIC_TICKER" } : item), "KRW-BTC"), /metadata/);
  assert.throws(() => parsePublicCandles(candles().map((item, index) => index === 2 ? { ...item, high_price: 1 } : item), "KRW-BTC"), /OHLC/);
  assert.throws(() => parsePublicCandles(candles().map((item, index) => index === 2 ? { ...item, candle_date_time_utc: new Date(240_000).toISOString().replace(".000Z", "") } : item), "KRW-BTC"), /contiguous/);
});

test("ready chart exposes only verified current price, high, low, volume, and price line", () => {
  const model = buildChartViewModel({ market: "KRW-BTC", interval: "1m", rawCandles: candles(), currentPrice: 110, connectionState: "HEALTHY", stale: false });
  assert.equal(model.state, "READY");
  assert.equal(model.currentPrice, 110);
  assert.equal(model.high, 112);
  assert.equal(model.low, 98);
  assert.equal(model.volume, 55);
  assert.ok(model.priceLine !== null);
  assert.equal(model.bars.length, 10);
});

test("chart remains fail-closed for loading, stale, missing-price, and incomplete data", () => {
  const base = { market: "KRW-BTC", interval: "1m", currentPrice: 110, connectionState: "HEALTHY", stale: false };
  assert.equal(buildChartViewModel({ ...base, rawCandles: null }).state, "LOADING");
  assert.equal(buildChartViewModel({ ...base, rawCandles: candles(), stale: true }).error, "MARKET_DATA_NOT_READY");
  assert.equal(buildChartViewModel({ ...base, rawCandles: candles(), currentPrice: null }).error, "PRICE_NOT_RECEIVED");
  assert.equal(buildChartViewModel({ ...base, rawCandles: candles(3), interval: "5m" }).state, "EMPTY");
});

test("chart UI stays read-only while the app shell uses only the authenticated PAPER operations projection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "chartView.tsx"), "utf8");
  const workspace = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "personalPaperOperationsClient.ts"), "utf8");

  assert.match(source, /PUBLIC \/ READ ONLY/);
  assert.match(source, /chart-loading/);
  assert.match(source, /chart-empty/);
  assert.match(source, /chart-error/);
  assert.match(source, /chart-price-line/);
  assert.match(source, /chart-intervals/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  assert.match(app, /loadPersonalPaperOperations/);
  assert.match(app, /<MarketsView/);
  assert.match(workspace, /<ChartView/);
  assert.doesNotMatch(app, /\/api\/(?:candles|markets|account|status)/);
  assert.match(client, /\/api\/paper-operations/);
  assert.match(client, /authorization:\s*`Bearer/);
  assert.match(client, /unavailableDashboardCredentialProvider/);
  assert.doesNotMatch(client, /EXPO_PUBLIC_.*TOKEN|hardcoded.*token|Bearer\s+[A-Za-z0-9._-]{16,}/i);
});
