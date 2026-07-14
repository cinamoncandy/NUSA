const test = require("node:test");
const assert = require("node:assert/strict");
const { computeLiquiditySweepFeature } = require("../dist/apps/cloud/src/alpha/liquidity/LiquiditySweepFeature.js");

const policy = {
  featureVersion: 1,
  depthLevels: 2,
  minimumSweepNotional: 500,
  minimumConsumedDepthRatio: 0.2,
  maximumSpreadRate: 0.01,
  staleAfterMs: 1000
};

const snapshot = (overrides = {}) => ({
  snapshotId: "S1",
  market: "KRW-BTC",
  capturedAt: "2026-01-01T00:00:00.000Z",
  bestBid: 99,
  bestAsk: 101,
  bids: [{ price: 99, quantity: 5 }, { price: 98, quantity: 5 }],
  asks: [{ price: 101, quantity: 5 }, { price: 102, quantity: 5 }],
  lastTradePrice: 101,
  lastTradeQuantity: 3,
  aggressorSide: "BUY",
  source: "PUBLIC_ORDERBOOK",
  ...overrides
});

test("detects deterministic upward sweep", () => {
  const first = computeLiquiditySweepFeature(snapshot(), "2026-01-01T00:00:00.100Z", policy);
  const second = computeLiquiditySweepFeature(snapshot(), "2026-01-01T00:00:00.100Z", policy);
  assert.equal(first.side, "UP_SWEEP");
  assert.equal(first.eligible, true);
  assert.deepEqual(first, second);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.reasons));
});

test("detects downward sweep", () => {
  const result = computeLiquiditySweepFeature(snapshot({ lastTradePrice: 99, aggressorSide: "SELL" }), "2026-01-01T00:00:00.100Z", policy);
  assert.equal(result.side, "DOWN_SWEEP");
  assert.equal(result.eligible, true);
});

test("fails closed for stale, weak, and non-directional observations", () => {
  const stale = computeLiquiditySweepFeature(snapshot(), "2026-01-01T00:00:02.000Z", policy);
  assert.equal(stale.eligible, false);
  assert.ok(stale.reasons.includes("SNAPSHOT_STALE"));

  const weak = computeLiquiditySweepFeature(snapshot({ lastTradeQuantity: 0.1 }), "2026-01-01T00:00:00.100Z", policy);
  assert.equal(weak.eligible, false);
  assert.ok(weak.reasons.includes("SWEEP_NOTIONAL_LOW"));

  const none = computeLiquiditySweepFeature(snapshot({ lastTradePrice: 100, aggressorSide: "UNKNOWN" }), "2026-01-01T00:00:00.100Z", policy);
  assert.equal(none.side, "NONE");
  assert.equal(none.eligible, false);
});

test("rejects malformed and crossed books", () => {
  assert.throws(() => computeLiquiditySweepFeature(snapshot({ bestBid: 101, bestAsk: 101 }), "2026-01-01T00:00:00.100Z", policy), /uncrossed/);
  assert.throws(() => computeLiquiditySweepFeature(snapshot({ bids: [{ price: 99, quantity: 1 }, { price: 100, quantity: 1 }] }), "2026-01-01T00:00:00.100Z", policy), /descending/);
  assert.throws(() => computeLiquiditySweepFeature(snapshot(), "2025-12-31T23:59:59.000Z", policy), /cannot precede/);
});
