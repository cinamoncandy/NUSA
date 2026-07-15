const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUpbitMarkets,
  shouldAcceptUpbitTicker,
  upbitReconnectDelay
} = require("../dist/apps/desktop/src/upbitWebSocket.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100000000,
  trade_timestamp: 1000,
  ...overrides
});

test("market subscriptions are normalized, deduplicated, and validated", () => {
  assert.deepEqual(normalizeUpbitMarkets([" krw-btc ", "KRW-ETH", "KRW-BTC"]), ["KRW-BTC", "KRW-ETH"]);
  assert.deepEqual(normalizeUpbitMarkets("krw-btc"), ["KRW-BTC"]);
  assert.throws(() => normalizeUpbitMarkets([" "]), /at least one/);
});

test("reconnect delay uses bounded exponential backoff", () => {
  assert.equal(upbitReconnectDelay(1), 1000);
  assert.equal(upbitReconnectDelay(2), 2000);
  assert.equal(upbitReconnectDelay(3), 4000);
  assert.equal(upbitReconnectDelay(6), 30000);
  assert.equal(upbitReconnectDelay(20), 30000);
  assert.throws(() => upbitReconnectDelay(0), /positive safe integer/);
});

test("ticker acceptance rejects unrelated, invalid, duplicate, and out-of-order messages", () => {
  const markets = ["KRW-BTC", "KRW-ETH"];
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets), true);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 999), true);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 1000), false);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 1001), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ code: "KRW-XRP" }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_price: 0 }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_price: Number.NaN }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_timestamp: -1 }), markets), false);
});
