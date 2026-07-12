const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyMarketRegime, evaluateRegimeTransition, routeStrategiesForRegime } = require("../dist/apps/cloud/src/marketRegimeEngine.js");

const features = (overrides = {}) => ({
  trendStrength: 0.1,
  returnZScore: 0.1,
  volatilityZScore: -0.2,
  volumeZScore: 0,
  fundingZScore: 0,
  openInterestZScore: 0,
  liquidationZScore: 0,
  breadthScore: 0.1,
  riskScore: 0.2,
  observedAt: 1_000,
  ...overrides
});

test("classifies panic deterministically and freezes output", () => {
  const input = features({ returnZScore: -3, volatilityZScore: 2, liquidationZScore: 3, riskScore: 1 });
  const first = classifyMarketRegime(input);
  assert.equal(first.regime, "PANIC");
  assert.deepEqual(first, classifyMarketRegime(input));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.reasons));
});

test("positive trend enables trend routing", () => {
  const snapshot = classifyMarketRegime(features({ trendStrength: 1.8, returnZScore: 1.2, breadthScore: 0.9, riskScore: 0.1 }));
  assert.equal(snapshot.regime, "TREND_UP");
  const policy = routeStrategiesForRegime(snapshot);
  assert.equal(policy.allowTrend, true);
  assert.equal(policy.allowNewExposure, true);
  assert.ok(Object.isFrozen(policy));
});

test("panic disables new exposure and funding carry", () => {
  const snapshot = classifyMarketRegime(features({ returnZScore: -4, volatilityZScore: 3, liquidationZScore: 4, riskScore: 1 }));
  const policy = routeStrategiesForRegime(snapshot);
  assert.equal(policy.allowNewExposure, false);
  assert.equal(policy.allowFundingCarry, false);
  assert.equal(policy.exposureMultiplier, 0);
});

test("tracks stable and changed transitions", () => {
  const first = classifyMarketRegime(features({ trendStrength: 1.8, returnZScore: 1.2, breadthScore: 0.9 }));
  const same = classifyMarketRegime(features({ trendStrength: 1.7, returnZScore: 1.1, breadthScore: 0.8, observedAt: 2_000 }));
  const changed = classifyMarketRegime(features({ returnZScore: -4, volatilityZScore: 3, liquidationZScore: 4, riskScore: 1, observedAt: 3_000 }));
  assert.equal(evaluateRegimeTransition(first, same).changed, false);
  assert.equal(evaluateRegimeTransition(same, changed).changed, true);
  assert.equal(evaluateRegimeTransition(same, changed).to, "PANIC");
});

test("invalid features and timestamp reversal fail closed", () => {
  assert.throws(() => classifyMarketRegime(features({ riskScore: 2 })), /riskScore/);
  assert.throws(() => classifyMarketRegime(features({ breadthScore: -2 })), /breadthScore/);
  assert.throws(() => classifyMarketRegime(features({ trendStrength: Number.NaN })), /finite/);
  const previous = classifyMarketRegime(features({ observedAt: 2_000 }));
  const next = classifyMarketRegime(features({ observedAt: 1_000 }));
  assert.throws(() => evaluateRegimeTransition(previous, next), /non-decreasing/);
});
