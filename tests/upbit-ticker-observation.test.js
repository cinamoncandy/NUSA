const test = require("node:test");
const assert = require("node:assert/strict");
const { upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100_000_000,
  trade_timestamp: 9_000,
  signed_change_rate: 0.0123,
  acc_trade_price_24h: 500_000_000,
  ...overrides
});

test("maps an Upbit ticker to stable, bounded intelligence evidence", () => {
  const observation = upbitTickerToIntelligenceObservation(ticker(), { now: 10_000, staleWindowMs: 2_000 });
  assert.deepEqual(observation, {
    id: "KRW-BTC:9000",
    source: "CHART",
    sentiment: 0.0123,
    confidence: 0.25,
    observedAt: 9000,
    expiresAt: 11000,
    summary: "KRW-BTC 100000000 (+1.23%)"
  });
});

test("clamps sentiment and confidence to their contracts", () => {
  const observation = upbitTickerToIntelligenceObservation(ticker({ signed_change_rate: 99, acc_trade_price_24h: 99_000_000_000 }), { now: 9000 });
  assert.equal(observation.sentiment, 1);
  assert.equal(observation.confidence, 1);
  const negative = upbitTickerToIntelligenceObservation(ticker({ signed_change_rate: -99, acc_trade_price_24h: 0 }), { now: 9000 });
  assert.equal(negative.sentiment, -1);
  assert.equal(negative.confidence, 0);
});

test("rejects stale, future, and non-KRW tickers", () => {
  assert.equal(upbitTickerToIntelligenceObservation(ticker(), { now: 12_001, staleWindowMs: 3_000 }), undefined);
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 12_000 }), { now: 11_000 }), undefined);
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ code: "USDT-BTC" }), { now: 10_000 }), undefined);
});
