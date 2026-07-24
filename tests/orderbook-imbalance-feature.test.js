const test = require("node:test");
const assert = require("node:assert/strict");
const { computeOrderbookImbalanceFeature } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceFeature.js");

const snapshot = {
  snapshotId: "OB-1",
  market: "BTCUSDT",
  capturedAt: "2026-01-01T00:00:00.000Z",
  bids: [{ price: 100, quantity: 5 }, { price: 99, quantity: 3 }, { price: 98, quantity: 2 }],
  asks: [{ price: 101, quantity: 2 }, { price: 102, quantity: 2 }, { price: 103, quantity: 1 }],
  sequence: 10,
  source: "TEST"
};
const policy = { featureVersion: 1, depthLevels: 3, minimumTotalQuantity: 1, maximumSpreadRate: 0.02, staleAfterMs: 1000 };

test("computes deterministic immutable orderbook features", () => {
  const first = computeOrderbookImbalanceFeature(snapshot, "2026-01-01T00:00:00.500Z", policy);
  const second = computeOrderbookImbalanceFeature(snapshot, "2026-01-01T00:00:00.500Z", policy);
  assert.deepEqual(first, second);
  assert.equal(first.eligible, true);
  assert.equal(first.bookImbalance, 0.333333333);
  assert.equal(first.queueImbalance, 0.428571429);
  assert.equal(first.microprice, 100.714285714);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
});

test("fails closed for stale and structurally invalid books", () => {
  const stale = computeOrderbookImbalanceFeature(snapshot, "2026-01-01T00:00:02.000Z", policy);
  assert.equal(stale.eligible, false);
  assert.ok(stale.reasons.includes("SNAPSHOT_STALE"));
  assert.throws(() => computeOrderbookImbalanceFeature({ ...snapshot, asks: [{ price: 100, quantity: 1 }] }, "2026-01-01T00:00:00.500Z", policy), /crossed or locked/);
  assert.throws(() => computeOrderbookImbalanceFeature({ ...snapshot, bids: [{ price: 99, quantity: 1 }, { price: 100, quantity: 1 }] }, "2026-01-01T00:00:00.500Z", policy), /descending/);
});
