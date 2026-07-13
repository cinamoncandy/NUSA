const test = require("node:test");
const assert = require("node:assert/strict");
const { createMarketState } = require("../dist/apps/cloud/src/marketStateEngine.js");

const observations = (overrides = {}) => [
  ["RETURN_5M", 0.012],
  ["REALIZED_VOLATILITY", 0.03],
  ["SPREAD_BPS", 8],
  ["ORDER_BOOK_IMBALANCE", 0.6],
  ["DEPTH_USD", 2_000_000],
  ["FUNDING_RATE", 0.0002],
  ["OPEN_INTEREST_CHANGE", 0.04],
  ["LIQUIDATION_INTENSITY", 0.1]
].map(([name, value]) => ({
  name,
  value: Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : value,
  observedAt: "2026-07-13T00:00:00.000Z",
  source: "fixture",
  sourceVersion: "v1"
}));

const input = (overrides = {}) => ({
  market: "BTC-USD",
  generatedAt: "2026-07-13T00:00:05.000Z",
  maxSignalAgeMs: 10_000,
  minimumDepthUsd: 1_000_000,
  observations: observations(),
  ...overrides
});

test("creates a deterministic immutable market state", () => {
  const first = createMarketState(input());
  const second = createMarketState(input());
  assert.deepEqual(first, second);
  assert.equal(first.regime, "TREND_UP");
  assert.ok(first.confidence > 0.5);
  assert.equal(first.provenance.length, 8);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.provenance));
  assert.ok(Object.isFrozen(first.provenance[0]));
});

test("classifies liquidity stress before directional regimes", () => {
  const state = createMarketState(input({
    observations: observations({
      SPREAD_BPS: 60,
      DEPTH_USD: 100_000,
      LIQUIDATION_INTENSITY: 0.9,
      REALIZED_VOLATILITY: 0.09
    })
  }));
  assert.equal(state.regime, "LIQUIDITY_STRESS");
  assert.ok(state.stressScore >= 0.8);
  assert.ok(state.liquidityScore < 0.35);
});

test("fails closed when a required signal is missing", () => {
  assert.throws(
    () => createMarketState(input({ observations: observations().filter((item) => item.name !== "FUNDING_RATE") })),
    /required market signal FUNDING_RATE is missing/
  );
});

test("fails closed on stale or future observations", () => {
  const stale = observations().map((item) => item.name === "RETURN_5M"
    ? { ...item, observedAt: "2026-07-12T23:59:00.000Z" }
    : item);
  assert.throws(() => createMarketState(input({ observations: stale })), /RETURN_5M is stale/);

  const future = observations().map((item) => item.name === "RETURN_5M"
    ? { ...item, observedAt: "2026-07-13T00:00:06.000Z" }
    : item);
  assert.throws(() => createMarketState(input({ observations: future })), /cannot be observed in the future/);
});

test("rejects duplicate signals and malformed provenance", () => {
  assert.throws(
    () => createMarketState(input({ observations: [...observations(), observations()[0]] })),
    /duplicate market signal RETURN_5M/
  );

  const malformed = observations().map((item) => item.name === "DEPTH_USD" ? { ...item, source: "" } : item);
  assert.throws(() => createMarketState(input({ observations: malformed })), /DEPTH_USD source is required/);
});

test("does not produce a trade action", () => {
  const state = createMarketState(input());
  assert.equal(Object.prototype.hasOwnProperty.call(state, "action"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state, "order"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state, "positionSize"), false);
});
