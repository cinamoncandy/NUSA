const test = require("node:test");
const assert = require("node:assert/strict");
const { startMobileBridge } = require("../dist/apps/desktop/src/mobileBridge.js");
const fs = require("node:fs");
const path = require("node:path");

test("mobile bridge source is localhost-only and has no mutation or wildcard CORS surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "mobileBridge.ts"), "utf8");
  assert.doesNotMatch(source, /0\.0\.0\.0|Access-Control-Allow-Origin|placeOrder|cancelOrder|withdraw/);
  assert.match(source, /127\.0\.0\.1/);
  assert.doesNotMatch(source, /POST|PUT|PATCH|DELETE/);
  const main = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
  assert.match(main, /NUSA_MOBILE_MONITOR_ENABLED !== "true"/);
  assert.match(main, /NUSA_MOBILE_MONITOR_PORT/);
});

test("mobile bridge is localhost read-only and exposes safe DTOs only", async () => {
  const observedAt = new Date().toISOString();
  const bridge = startMobileBridge({ port: 41731, getStatus: () => ({ app: "NUSA", mode: "PAPER", marketConnectionState: "HEALTHY", warmupState: "READY", stale: false, observedAt }), getAccount: () => ({ available: true, cash: 100, equity: 100, unrealizedPnl: 0, markPrice: 100, position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 }, orders: [] }), getOpenOrderCount: () => 0, getMarkets: () => [{ market: "KRW-BTC", price: 100, changeRate: 0.01, volume: 2, observedAt, source: "UPBIT_PUBLIC_TICKER" }], getCandles: () => [{ market: "KRW-BTC", interval: "1m", openTime: 0, closeTime: 60000, open: 100, high: 101, low: 99, close: 100, volume: 1, source: "UPBIT_PUBLIC_CANDLE" }], getEvents: () => [{ code: "SAFE" }] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const health = await fetch("http://127.0.0.1:41731/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const status = await fetch("http://127.0.0.1:41731/api/status");
    assert.equal((await status.json()).contractVersion, "1.0.0");
    const account = await fetch("http://127.0.0.1:41731/api/account");
    const accountPayload = await account.json();
    assert.equal(accountPayload.contractVersion, "1.0.0");
    assert.equal(accountPayload.account.cash, 100);
    const markets = await fetch("http://127.0.0.1:41731/api/markets");
    assert.equal(markets.status, 200);
    assert.equal((await markets.json()).markets.length, 1);
    const candles = await fetch("http://127.0.0.1:41731/api/candles?market=KRW-BTC&interval=1m&count=1");
    assert.equal(candles.status, 200);
    assert.equal((await candles.json()).candles.length, 1);
    const mutation = await fetch("http://127.0.0.1:41731/api/status", { method: "POST" });
    assert.equal(mutation.status, 405);
    const missing = await fetch("http://127.0.0.1:41731/control/start", { method: "POST" });
    assert.equal(missing.status, 405);
  } finally { await bridge.stop(); }
});

test("mobile bridge fails closed when a monitor provider violates the shared contract", async () => {
  const observedAt = new Date().toISOString();
  const bridge = startMobileBridge({ port: 41732, getStatus: () => ({ app: "NUSA", mode: "PAPER", marketConnectionState: "HEALTHY", warmupState: "READY", stale: false, observedAt }), getAccount: () => ({ available: false, reason: "MARKET_DATA_UNAVAILABLE" }), getOpenOrderCount: () => 0, getMarkets: () => [{ market: "KRW-BTC", price: 0, changeRate: null, volume: null, observedAt, source: "UPBIT_PUBLIC_TICKER" }], getEvents: () => [] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fetch("http://127.0.0.1:41732/api/markets");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "monitor unavailable" });
  } finally { await bridge.stop(); }
});
