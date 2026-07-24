const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateFundingPersistenceStrategy } = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceStrategy.js");

const policy = Object.freeze({
  strategyVersion: 1,
  minimumFeatureVersion: 1,
  minimumQuality: 0.9,
  minimumAbsoluteZScore: 2,
  minimumPersistenceSamples: 2,
  minimumPersistenceRatio: 0.2,
  minimumOpenInterestDelta: 0.01,
  maximumAbsoluteBasisRate: 0.02,
  maximumFeatureAgeMs: 60_000,
  exitAbsoluteZScore: 0.5
});

const feature = Object.freeze({
  featureId: "FUNDING_PERSISTENCE",
  featureVersion: 1,
  market: "BTCUSDT",
  generatedAt: "2026-07-13T12:00:00.000Z",
  sourceStartAt: "2026-07-13T02:00:00.000Z",
  sourceEndAt: "2026-07-13T12:00:00.000Z",
  sampleCount: 10,
  fundingRate: 0.001,
  fundingMean: 0.0002,
  fundingStdDev: 0.0003,
  fundingZScore: 2.666667,
  fundingVelocity: 0.0001,
  fundingAcceleration: 0,
  persistenceSamples: 3,
  persistenceRatio: 0.3,
  openInterestDelta: 0.05,
  volumeDelta: 0.1,
  basisRate: 0.005,
  fundingOpenInterestInteraction: 0.00005,
  fundingVolumeInteraction: 0.0001,
  direction: "POSITIVE",
  quality: 1,
  warnings: Object.freeze([]),
  provenance: Object.freeze(["s1", "s2", "s3"])
});

const input = Object.freeze({
  decisionId: "decision-001",
  generatedAt: "2026-07-13T12:00:30.000Z",
  currentPosition: "FLAT",
  feature
});

test("enters short for eligible positive persistent funding", () => {
  const result = evaluateFundingPersistenceStrategy(input, policy);
  assert.equal(result.action, "ENTER_SHORT");
  assert.equal(result.targetPosition, "SHORT");
  assert.equal(result.eligible, true);
  assert.ok(result.signalStrength > 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("enters long for eligible negative persistent funding", () => {
  const result = evaluateFundingPersistenceStrategy({
    ...input,
    decisionId: "decision-002",
    feature: { ...feature, fundingZScore: -2.7, direction: "NEGATIVE" }
  }, policy);
  assert.equal(result.action, "ENTER_LONG");
  assert.equal(result.targetPosition, "LONG");
});

test("holds when position is already aligned", () => {
  const result = evaluateFundingPersistenceStrategy({ ...input, currentPosition: "SHORT" }, policy);
  assert.equal(result.action, "HOLD");
  assert.equal(result.targetPosition, "SHORT");
});

test("exits an open position after mean reversion", () => {
  const result = evaluateFundingPersistenceStrategy({
    ...input,
    currentPosition: "SHORT",
    feature: { ...feature, fundingZScore: 0.25, direction: "NEUTRAL", persistenceSamples: 0, persistenceRatio: 0 }
  }, policy);
  assert.equal(result.action, "EXIT");
  assert.equal(result.targetPosition, "FLAT");
});

test("fails closed when any entry gate fails", () => {
  const result = evaluateFundingPersistenceStrategy({
    ...input,
    feature: { ...feature, quality: 0.5, warnings: ["ZERO_VOLUME"], openInterestDelta: 0 }
  }, policy);
  assert.equal(result.action, "ABSTAIN");
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("FEATURE_QUALITY_LOW"));
  assert.ok(result.reasons.includes("FEATURE_WARNINGS_PRESENT"));
  assert.ok(result.reasons.includes("OPEN_INTEREST_CONFIRMATION_FAILED"));
});

test("rejects stale and future features", () => {
  const stale = evaluateFundingPersistenceStrategy({ ...input, generatedAt: "2026-07-13T12:02:00.001Z" }, policy);
  assert.equal(stale.action, "ABSTAIN");
  assert.ok(stale.reasons.includes("FEATURE_STALE"));

  assert.throws(() => evaluateFundingPersistenceStrategy({
    ...input,
    generatedAt: "2026-07-13T11:59:59.000Z"
  }, policy), /future/);
});

test("validates exit threshold ordering", () => {
  assert.throws(() => evaluateFundingPersistenceStrategy(input, {
    ...policy,
    exitAbsoluteZScore: 2
  }), /below minimumAbsoluteZScore/);
});
