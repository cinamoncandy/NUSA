const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("default fill model reproduces exact, unslipped, fully-filled execution", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
  const buy = broker.execute("BUY", 0.01, 50_000_000, new Date("2026-01-01T00:00:00Z"));
  assert.equal(buy.price, 50_000_000);
  assert.equal(buy.quantity, 0.01);
  assert.equal(buy.requestedQuantity, 0.01);
  assert.equal(buy.quotedPrice, 50_000_000);
  assert.equal(buy.fee, 500);
  assert.equal(buy.spreadCost, 0);
  assert.equal(buy.slippageCost, 0);
  assert.equal(buy.marketImpactCost, 0);
  assert.equal(broker.exportState().ledger.length, 1);
  assert.equal(broker.exportState().ledger[0].fillId, `fill:${buy.id}`);
});

test("Paper ledger appends buy and sell entries and survives restore", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const buy = broker.execute("BUY", 1, 100, new Date(1_000));
  const sell = broker.execute("SELL", 1, 110, new Date(2_000));
  const state = broker.exportState();
  assert.deepEqual(state.ledger.map((entry) => entry.sequence), [1, 2]);
  assert.equal(state.ledger[0].orderId, buy.id);
  assert.equal(state.ledger[1].orderId, sell.id);
  assert.equal(state.ledger[0].cashBefore, 1_000);
  assert.equal(state.ledger[1].positionQuantityBefore, 1);
  const restored = new PaperBroker(1_000, "KRW-BTC", 0, {}, state);
  assert.deepEqual(restored.exportState().ledger, state.ledger);
});

test("invalid execution time is rejected before Paper accounting mutates", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const before = broker.snapshot(100);
  assert.throws(() => broker.execute("BUY", 1, 100, new Date("invalid")), /now must be a valid date/);
  assert.deepEqual(broker.snapshot(100), before);
});

test("strategy attribution is optional and survives Paper order export", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const order = broker.execute("BUY", 1, 100, new Date(0), { strategyId: "sma-crossover" });
  assert.equal(order.strategyId, "sma-crossover");
  assert.equal(broker.exportState().orders[0].strategyId, "sma-crossover");
});

test("market impact adds adverse price movement that scales with order size", () => {
  const small = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { marketImpactBpsPerUnit: 1000 });
  const smallOrder = small.execute("BUY", 0.01, 1_000_000);
  // impactBps = quantity * marketImpactBpsPerUnit = 0.01 * 1000 = 10
  assertClose(smallOrder.price, 1_001_000);
  assert.equal(smallOrder.marketImpactCost, 10); // 1_000_000 * 0.01 * 10 / 10_000

  const large = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { marketImpactBpsPerUnit: 1000 });
  const largeOrder = large.execute("BUY", 0.02, 1_000_000);
  // impactBps = 0.02 * 1000 = 20
  assertClose(largeOrder.price, 1_002_000);
  assert.equal(largeOrder.marketImpactCost, 40); // 1_000_000 * 0.02 * 20 / 10_000 -- quadratic in size, not linear

  const sell = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { marketImpactBpsPerUnit: 1000 });
  sell.execute("BUY", 0.01, 1_000_000);
  const sellOrder = sell.execute("SELL", 0.01, 1_000_000);
  assertClose(sellOrder.price, 999_000);
});

test("market impact stacks with slippage and spread in the fill price", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { slippageBps: 30, spreadBps: 20, marketImpactBpsPerUnit: 1000 });
  const order = broker.execute("BUY", 0.01, 1_000_000);
  // adverse bps = slippageBps + spreadBps/2 + quantity*marketImpactBpsPerUnit = 30 + 10 + 10 = 50
  assertClose(order.price, 1_005_000);
  assert.equal(order.marketImpactCost, 10);
});

test("marketImpactBpsPerUnit must be non-negative", () => {
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { marketImpactBpsPerUnit: -1 }), /marketImpactBpsPerUnit must be non-negative/);
});

test("spread cost charges half the quoted spread against the trader on both sides, itemized separately from slippage", () => {
  const buyBroker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { spreadBps: 100 });
  const buy = buyBroker.execute("BUY", 0.01, 1_000_000);
  assertClose(buy.price, 1_005_000); // half of 100bps = 50bps applied to the fill price
  assert.equal(buy.spreadCost, 50); // 1_000_000 * 0.01 * 100 / 20_000
  assert.equal(buy.slippageCost, 0);

  const sellBroker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { spreadBps: 100 });
  sellBroker.execute("BUY", 0.01, 1_000_000);
  const sell = sellBroker.execute("SELL", 0.01, 1_000_000);
  assertClose(sell.price, 995_000);
  assert.equal(sell.spreadCost, 50);
});

test("combined spread and slippage stack in the fill price and are itemized separately on the order", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { slippageBps: 30, spreadBps: 20 });
  const buy = broker.execute("BUY", 0.01, 1_000_000);
  // adverse bps = slippageBps + spreadBps / 2 = 30 + 10 = 40
  assertClose(buy.price, 1_004_000);
  assert.equal(buy.slippageCost, 30); // 1_000_000 * 0.01 * 30 / 10_000
  assert.equal(buy.spreadCost, 10); // 1_000_000 * 0.01 * 20 / 20_000
});

test("slippage moves the fill price against the trader on both sides", () => {
  const buyBroker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { slippageBps: 100 });
  const buy = buyBroker.execute("BUY", 0.01, 1_000_000);
  assert.equal(buy.price, 1_010_000);
  assert.equal(buy.quotedPrice, 1_000_000);

  const sellBroker = new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { slippageBps: 100 });
  sellBroker.execute("BUY", 0.01, 1_000_000);
  const sell = sellBroker.execute("SELL", 0.01, 1_000_000);
  assert.equal(sell.price, 990_000);
});

test("maxFillRatio caps the filled quantity below the requested quantity and does not queue the remainder", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { quantityStep: 0.0001 }, undefined, { maxFillRatio: 0.5 });
  const order = broker.execute("BUY", 0.02, 1_000_000);
  assert.equal(order.requestedQuantity, 0.02);
  assert.equal(order.quantity, 0.01);
  const snapshot = broker.snapshot(1_000_000);
  assert.equal(snapshot.position.quantity, 0.01);
});

test("combined slippage and partial fill still respects risk and cash limits using the conservative fill price", () => {
  const broker = new PaperBroker(10_100, "KRW-BTC", 0, { maxOrderNotional: 100_000 }, undefined, { slippageBps: 500, maxFillRatio: 1 });
  assert.throws(() => broker.execute("BUY", 0.01, 1_000_000), /insufficient paper cash/);
});

test("maxFillRatio must be in (0, 1] and slippageBps must be non-negative", () => {
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { maxFillRatio: 0 }), /maxFillRatio must be in \(0, 1\]/);
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { maxFillRatio: 1.5 }), /maxFillRatio must be in \(0, 1\]/);
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { slippageBps: -1 }), /slippageBps must be non-negative/);
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, {}, undefined, { spreadBps: -1 }), /spreadBps must be non-negative/);
});
