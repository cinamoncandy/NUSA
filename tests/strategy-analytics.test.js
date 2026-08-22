const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStrategyAnalytics, verifyStrategyAnalytics } = require("../dist/apps/desktop/src/strategy/strategyAnalytics.js");

const order = (overrides = {}) => ({
  id: "1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 100, fee: 1,
  filledAt: "2026-01-01T00:00:00.000Z", requestedQuantity: 1, quotedPrice: 100,
  spreadCost: 0, slippageCost: 0, marketImpactCost: 0, strategyId: "sma-crossover", ...overrides
});

test("replays attributed strategy orders independently", () => {
  const result = buildStrategyAnalytics({
    orders: [order(), order({ id: "2", side: "SELL", price: 110, fee: 1, filledAt: "2026-01-01T00:01:00.000Z" })],
    strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 110
  });
  assert.equal(result.orderCount, 2);
  assert.equal(result.quantity, 0);
  assert.equal(result.realizedPnl, 8);
  assert.equal(result.unrealizedPnl, 0);
  assert.equal(result.netPnl, 8);
  assert.equal(result.fees, 2);
  assert.equal(result.portfolioCaptureRatio, 1);
  assert.deepEqual(verifyStrategyAnalytics(result), []);
});

test("manual or foreign strategy orders make attribution unavailable", () => {
  assert.equal(buildStrategyAnalytics({
    orders: [order({ strategyId: undefined })], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 100
  }), null);
  assert.equal(buildStrategyAnalytics({
    orders: [order({ strategyId: "other" })], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 100
  }), null);
});

test("invalid fills fail closed", () => {
  assert.throws(() => buildStrategyAnalytics({
    orders: [order({ quantity: 0 })], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 100
  }), /quantity must be positive/);
  assert.equal(buildStrategyAnalytics({
    orders: [order(), order({ id: "2", side: "SELL", quantity: 2, filledAt: "2026-01-01T00:01:00.000Z" })],
    strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 100
  }), null);
});

test("analytics hash detects altered results", () => {
  const result = buildStrategyAnalytics({ orders: [], strategyId: "sma-crossover", market: "KRW-BTC", markPrice: 100 });
  assert.deepEqual(verifyStrategyAnalytics({ ...result, netPnl: 99 }), ["SOURCE_HASH_MISMATCH"]);
});
