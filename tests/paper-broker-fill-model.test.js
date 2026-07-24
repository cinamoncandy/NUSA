const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");

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
