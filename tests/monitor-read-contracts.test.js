const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MONITOR_READ_CONTRACT_VERSION,
  parseMonitorAccountResponse,
  parseMonitorCandlesResponse,
  parseMonitorMarketsResponse,
  parseMonitorStatusResponse
} = require("../dist/packages/contracts/src/monitorRead.js");

const observedAt = "2026-08-04T12:00:00.000Z";
const status = { app: "NUSA", mode: "PAPER", marketConnectionState: "HEALTHY", warmupState: "READY", stale: false, observedAt };
const market = { market: "KRW-BTC", price: 100, changeRate: 0.01, volume: 2, observedAt, source: "UPBIT_PUBLIC_TICKER" };
const candle = { market: "KRW-BTC", interval: "1m", openTime: 0, closeTime: 60000, open: 100, high: 101, low: 99, close: 100, volume: 1, source: "UPBIT_PUBLIC_CANDLE" };
const order = { id: "order-1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 100, fee: 1, filledAt: observedAt, requestedQuantity: 1, quotedPrice: 100, spreadCost: 0, slippageCost: 0, marketImpactCost: 0 };

test("monitor read contracts normalize legacy v1 payloads and preserve valid v1 SemVer", () => {
  assert.equal(parseMonitorStatusResponse(status).contractVersion, MONITOR_READ_CONTRACT_VERSION);
  assert.equal(parseMonitorStatusResponse({ ...status, contractVersion: "1.4.2" }).contractVersion, "1.4.2");
  assert.equal(parseMonitorMarketsResponse({ observedAt, markets: [market] }).markets[0].market, "KRW-BTC");
  assert.equal(parseMonitorCandlesResponse({ observedAt, market: "KRW-BTC", interval: "1m", candles: [candle] }).candles.length, 1);
  assert.equal(parseMonitorAccountResponse({ observedAt, mode: "PAPER", account: { cash: 100, equity: 100, unrealizedPnl: 0, markPrice: 100, position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 }, orders: [order] }, openOrderCount: 1 }).account.orders.length, 1);
});

test("monitor read contracts fail closed for incompatible versions and malformed payloads", () => {
  assert.throws(() => parseMonitorStatusResponse({ ...status, contractVersion: "2.0.0" }), /unsupported monitor contractVersion/);
  assert.throws(() => parseMonitorStatusResponse({ ...status, contractVersion: "v1" }), /unsupported monitor contractVersion/);
  assert.throws(() => parseMonitorMarketsResponse({ observedAt, markets: [{ ...market, price: 0 }] }), /positive/);
  assert.throws(() => parseMonitorCandlesResponse({ observedAt, market: "KRW-BTC", interval: "1m", candles: [{ ...candle, high: 98 }] }), /metadata/);
  assert.throws(() => parseMonitorCandlesResponse({ observedAt, market: "KRW-ETH", interval: "1m", candles: [candle] }), /response metadata/);
  assert.throws(() => parseMonitorAccountResponse({ observedAt, mode: "PAPER", account: { ...{ cash: 100, equity: 100, unrealizedPnl: 0, markPrice: 100, position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 }, orders: [order] }, orders: [{ ...order, requestedQuantity: 0 }] }, openOrderCount: 1 }), /requestedQuantity/);
  assert.throws(() => parseMonitorAccountResponse({ observedAt, mode: "PAPER", account: { cash: 100, equity: 100, unrealizedPnl: 0, markPrice: 100, position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 }, orders: [order] }, openOrderCount: 0 }), /does not match orders/);
});
