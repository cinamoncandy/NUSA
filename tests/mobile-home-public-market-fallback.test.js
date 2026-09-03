const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { selectHomeMarketData } = require("../dist/apps/mobile/src/homeMarketData.js");

const market = (name, price) => ({
  market: name,
  price,
  changeRate: null,
  volume: null,
  observedAt: "2026-09-01T00:00:00.000Z",
  source: "UPBIT_PUBLIC_TICKER",
});

test("Home prefers the independently loaded public market feed", () => {
  const publicMarkets = [market("KRW-BTC", 100)];
  const snapshotMarkets = [market("KRW-ETH", 200)];
  assert.strictEqual(selectHomeMarketData(publicMarkets, snapshotMarkets), publicMarkets);
});

test("Home uses the validated Cloud snapshot only while the public feed is unresolved", () => {
  const snapshotMarkets = [market("KRW-ETH", 200)];
  assert.strictEqual(selectHomeMarketData(null, snapshotMarkets), snapshotMarkets);
});

test("an empty public result is authoritative and does not fall back to stale snapshot data", () => {
  const publicMarkets = [];
  const snapshotMarkets = [market("KRW-ETH", 200)];
  assert.strictEqual(selectHomeMarketData(publicMarkets, snapshotMarkets), publicMarkets);
});

test("App forwards public quotation markets to Home and Home selects the source explicitly", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
  assert.match(app, /<HomeView[\s\S]*publicMarkets=\{publicMarkets\.markets\}/);
  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
});
