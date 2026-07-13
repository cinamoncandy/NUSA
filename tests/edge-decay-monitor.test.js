const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateEdgeDecay } = require("../dist/apps/cloud/src/edgeDecayMonitor.js");

const policy = Object.freeze({
  policyVersion: "edge-decay-v1",
  minimumRecentSamples: 100,
  yellowScore: 0.15,
  orangeScore: 0.35,
  redScore: 0.6,
  metricWeights: Object.freeze({
    sharpe: 2,
    winRate: 1,
    calibration: 1,
    profitFactor: 1,
    drawdown: 2,
    slippage: 1,
    capacity: 1
  })
});

const baseline = Object.freeze({
  windowId: "baseline-3y",
  startAt: "2023-01-01T00:00:00.000Z",
  endAt: "2025-12-31T00:00:00.000Z",
  sampleSize: 1200,
  sharpe: 2.2,
  winRate: 0.68,
  expectedCalibrationError: 0.04,
  profitFactor: 1.8,
  maximumDrawdown: 0.08,
  averageSlippageBps: 4,
  capacityUsd: 1_000_000
});

const healthyRecent = Object.freeze({
  windowId: "recent-90d",
  startAt: "2026-01-01T00:00:00.000Z",
  endAt: "2026-03-31T00:00:00.000Z",
  sampleSize: 150,
  sharpe: 2.1,
  winRate: 0.67,
  expectedCalibrationError: 0.045,
  profitFactor: 1.75,
  maximumDrawdown: 0.085,
  averageSlippageBps: 4.2,
  capacityUsd: 950_000
});

const input = Object.freeze({
  edgeId: "funding-carry",
  edgeVersion: "1.0.0",
  generatedAt: "2026-04-01T00:00:00.000Z",
  baseline,
  recent: healthyRecent
});

test("keeps a healthy edge green and immutable", () => {
  const result = evaluateEdgeDecay(input, policy);
  assert.equal(result.status, "GREEN");
  assert.equal(result.action, "MAINTAIN");
  assert.ok(result.decayScore < policy.yellowScore);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.metrics));
});

test("reduces capital when edge deterioration is material", () => {
  const result = evaluateEdgeDecay({
    ...input,
    recent: {
      ...healthyRecent,
      sharpe: 1.1,
      winRate: 0.55,
      expectedCalibrationError: 0.09,
      profitFactor: 1.2,
      maximumDrawdown: 0.14,
      averageSlippageBps: 7,
      capacityUsd: 600_000
    }
  }, policy);
  assert.equal(result.status, "ORANGE");
  assert.equal(result.action, "REDUCE_CAPITAL");
  assert.ok(result.reasons.includes("SHARPE_DETERIORATED"));
});

test("suspends a critically decayed edge", () => {
  const result = evaluateEdgeDecay({
    ...input,
    recent: {
      ...healthyRecent,
      sharpe: 0.1,
      winRate: 0.2,
      expectedCalibrationError: 0.25,
      profitFactor: 0.4,
      maximumDrawdown: 0.35,
      averageSlippageBps: 18,
      capacityUsd: 100_000
    }
  }, policy);
  assert.equal(result.status, "RED");
  assert.equal(result.action, "SUSPEND");
});

test("fails closed to observation when recent evidence is insufficient", () => {
  const result = evaluateEdgeDecay({
    ...input,
    recent: { ...healthyRecent, sampleSize: 20 }
  }, policy);
  assert.equal(result.status, "YELLOW");
  assert.equal(result.action, "OBSERVE");
  assert.ok(result.reasons.includes("INSUFFICIENT_RECENT_SAMPLES"));
});

test("rejects future windows and invalid thresholds", () => {
  assert.throws(() => evaluateEdgeDecay({
    ...input,
    recent: { ...healthyRecent, endAt: "2027-01-01T00:00:00.000Z" }
  }, policy), /cannot end in the future/);

  assert.throws(() => evaluateEdgeDecay(input, {
    ...policy,
    yellowScore: 0.5,
    orangeScore: 0.4
  }), /strictly increasing/);
});
