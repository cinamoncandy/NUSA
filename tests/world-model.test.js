const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorldModelSnapshot } = require("../dist/apps/cloud/src/worldModel.js");

const input = (overrides = {}) => ({ snapshotId: "snap-1", observedAt: 100, source: "paper-market", price: 100, volatility: 0.2, liquidity: 0.8, trendStrength: 0.7, evidenceQuality: "VERIFIED", ...overrides });

test("world model classifies verified market state deterministically", () => {
  const snapshot = buildWorldModelSnapshot(input(), 200);
  assert.equal(snapshot.regime, "TRENDING");
  assert.equal(snapshot.confidence, 1);
  assert.equal(snapshot.recommendationOnly, true);
});

test("stale or conflicted evidence becomes unknown", () => {
  const snapshot = buildWorldModelSnapshot(input({ evidenceQuality: "STALE" }), 200);
  assert.equal(snapshot.regime, "UNKNOWN");
  assert.equal(snapshot.confidence, 0);
});
