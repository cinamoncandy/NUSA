const test = require("node:test");
const assert = require("node:assert/strict");
const { computeTradeStatistics } = require("../dist/apps/server/src/tradeStatistics.js");

function order(overrides = {}) {
  return Object.freeze({
    id: "o1",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 1,
    price: 100,
    fee: 0,
    filledAt: "2026-01-01T00:00:00.000Z",
    requestedQuantity: 1,
    quotedPrice: 100,
    spreadCost: 0,
    slippageCost: 0,
    marketImpactCost: 0,
    ...overrides
  });
}

test("no orders: everything is zero/null", () => {
  const stats = computeTradeStatistics([]);
  assert.equal(stats.totalTrades, 0);
  assert.equal(stats.buyCount, 0);
  assert.equal(stats.sellCount, 0);
  assert.equal(stats.winRate, null);
  assert.equal(stats.totalRealizedPnl, 0);
  assert.equal(stats.averageWin, null);
  assert.equal(stats.averageLoss, null);
  assert.equal(stats.largestWin, null);
  assert.equal(stats.largestLoss, null);
});

test("only BUYs (no closed position): winRate is null, no wins/losses", () => {
  const stats = computeTradeStatistics([order({ side: "BUY" }), order({ side: "BUY" })]);
  assert.equal(stats.totalTrades, 2);
  assert.equal(stats.buyCount, 2);
  assert.equal(stats.sellCount, 0);
  assert.equal(stats.winRate, null);
});

test("a single winning round-trip (BUY then SELL above cost)", () => {
  const orders = [
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 150, fee: 1 })
  ];
  const stats = computeTradeStatistics(orders);
  assert.equal(stats.sellCount, 1);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.winRate, 1);
  // (150 - 100) * 1 - 1 = 49
  assert.equal(stats.totalRealizedPnl, 49);
  assert.equal(stats.averageWin, 49);
  assert.equal(stats.largestWin, 49);
  assert.equal(stats.averageLoss, null);
});

test("a single losing round-trip (SELL below cost)", () => {
  const orders = [
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 90, fee: 1 })
  ];
  const stats = computeTradeStatistics(orders);
  assert.equal(stats.wins, 0);
  assert.equal(stats.losses, 1);
  assert.equal(stats.winRate, 0);
  // (90 - 100) * 1 - 1 = -11
  assert.equal(stats.totalRealizedPnl, -11);
  assert.equal(stats.averageLoss, -11);
  assert.equal(stats.largestLoss, -11);
});

test("a break-even trade (realizedPnl exactly 0) counts toward the denominator but not wins or losses", () => {
  const orders = [
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 100, fee: 0 })
  ];
  const stats = computeTradeStatistics(orders);
  assert.equal(stats.wins, 0);
  assert.equal(stats.losses, 0);
  assert.equal(stats.sellCount, 1);
  assert.equal(stats.winRate, 0, "0 wins / 1 closed trade");
});

test("mixed wins and losses across multiple round-trips computes win rate and averages", () => {
  const orders = [
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 120, fee: 0 }), // +20
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 80, fee: 0 }), // -20
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "SELL", quantity: 1, price: 110, fee: 0 }) // +10
  ];
  const stats = computeTradeStatistics(orders);
  assert.equal(stats.sellCount, 3);
  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 1);
  assert.equal(stats.winRate, 2 / 3);
  assert.equal(stats.totalRealizedPnl, 10);
  assert.equal(stats.averageWin, 15);
  assert.equal(stats.averageLoss, -20);
  assert.equal(stats.largestWin, 20);
  assert.equal(stats.largestLoss, -20);
});

test("a weighted-average BUY cost is used for the realized PnL on a later partial SELL", () => {
  const orders = [
    order({ side: "BUY", quantity: 1, price: 100, fee: 0 }),
    order({ side: "BUY", quantity: 1, price: 200, fee: 0 }),
    // average cost = 150; sell 1 unit at 160 -> +10
    order({ side: "SELL", quantity: 1, price: 160, fee: 0 })
  ];
  const stats = computeTradeStatistics(orders);
  assert.equal(stats.totalRealizedPnl, 10);
});

test("computeTradeStatistics never mutates its input array or order objects", () => {
  const orders = [order({ side: "BUY" }), order({ side: "SELL", price: 150 })];
  const before = JSON.parse(JSON.stringify(orders));
  computeTradeStatistics(orders);
  assert.deepEqual(JSON.parse(JSON.stringify(orders)), before);
});

test("computeTradeStatistics is deterministic: identical inputs always produce identical results", () => {
  const orders = [order({ side: "BUY" }), order({ side: "SELL", price: 150, fee: 1 })];
  const results = Array.from({ length: 5 }, () => computeTradeStatistics(orders));
  for (const result of results) assert.deepEqual(result, results[0]);
});
