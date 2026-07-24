const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateProbabilityEdge } = require("../dist/apps/cloud/src/probabilityEdgeEngine.js");
const { planPositionRotation } = require("../dist/apps/cloud/src/positionRotationEngine.js");
const { evaluateExecutionQuality } = require("../dist/apps/cloud/src/executionQualityEngine.js");

const edgeInput = (overrides = {}) => ({
  symbol: "BTCUSDT",
  now: 1_000,
  modelProbabilityUp: 0.7,
  marketProbabilityUp: 0.55,
  confidence: 0.8,
  observedAt: 950,
  maxAgeMs: 100,
  estimatedRoundTripCost: 0.01,
  minimumNetEdge: 0.05,
  ...overrides
});

test("calculates net probability edge after costs", () => {
  const result = calculateProbabilityEdge(edgeInput());
  assert.equal(result.direction, "LONG");
  assert.equal(result.grossEdge, 0.12);
  assert.equal(result.netEdge, 0.11);
  assert.equal(Object.isFrozen(result), true);
});

test("suppresses stale or sub-threshold edge", () => {
  assert.equal(calculateProbabilityEdge(edgeInput({ observedAt: 800 })).direction, "NO_EDGE");
  assert.equal(calculateProbabilityEdge(edgeInput({ modelProbabilityUp: 0.58, minimumNetEdge: 0.05 })).direction, "NO_EDGE");
});

test("rotates exposure gradually and respects cooldown", () => {
  const edge = calculateProbabilityEdge(edgeInput());
  const plan = planPositionRotation({
    now: 1_000,
    edge,
    currentNetExposure: 0.1,
    maxAbsoluteExposure: 0.5,
    maxStep: 0.1,
    minimumStep: 0.02,
    cooldownMs: 100,
    reversalsInWindow: 0,
    maxReversalsInWindow: 2
  });
  assert.equal(plan.action, "INCREASE_LONG");
  assert.equal(plan.targetNetExposure, 0.2);

  const blocked = planPositionRotation({
    now: 1_000,
    edge,
    currentNetExposure: 0.1,
    maxAbsoluteExposure: 0.5,
    maxStep: 0.1,
    minimumStep: 0.02,
    lastRotationAt: 950,
    cooldownMs: 100,
    reversalsInWindow: 0,
    maxReversalsInWindow: 2
  });
  assert.equal(blocked.blockedReason, "COOLDOWN");
  assert.equal(blocked.delta, 0);
});

test("reduces before reversing and enforces reversal limit", () => {
  const shortEdge = calculateProbabilityEdge(edgeInput({ modelProbabilityUp: 0.3, marketProbabilityUp: 0.55 }));
  const reduce = planPositionRotation({
    now: 1_000,
    edge: shortEdge,
    currentNetExposure: 0.15,
    maxAbsoluteExposure: 0.5,
    maxStep: 0.1,
    minimumStep: 0.02,
    cooldownMs: 0,
    reversalsInWindow: 0,
    maxReversalsInWindow: 2
  });
  assert.equal(reduce.action, "REDUCE");
  assert.equal(reduce.targetNetExposure, 0.05);

  const blocked = planPositionRotation({
    now: 1_000,
    edge: shortEdge,
    currentNetExposure: 0.15,
    maxAbsoluteExposure: 0.5,
    maxStep: 0.1,
    minimumStep: 0.02,
    cooldownMs: 0,
    reversalsInWindow: 2,
    maxReversalsInWindow: 2
  });
  assert.equal(blocked.blockedReason, "REVERSAL_LIMIT");
});

test("grades execution quality from slippage and latency", () => {
  const good = evaluateExecutionQuality({
    symbol: "BTCUSDT",
    side: "BUY",
    expectedPrice: 100,
    actualPrice: 100.02,
    quantity: 2,
    feePaid: 0.02,
    submittedAt: 100,
    filledAt: 150,
    acceptableSlippageBps: 5,
    poorSlippageBps: 20,
    acceptableLatencyMs: 100,
    poorLatencyMs: 500
  });
  assert.equal(good.quality, "GOOD");
  assert.equal(good.slippageBps, 2);

  const poor = evaluateExecutionQuality({
    symbol: "BTCUSDT",
    side: "BUY",
    expectedPrice: 100,
    actualPrice: 100.3,
    quantity: 1,
    feePaid: 0.01,
    submittedAt: 100,
    filledAt: 700,
    acceptableSlippageBps: 5,
    poorSlippageBps: 20,
    acceptableLatencyMs: 100,
    poorLatencyMs: 500
  });
  assert.equal(poor.quality, "POOR");
  assert.ok(poor.warnings.includes("SLIPPAGE_POOR"));
  assert.ok(poor.warnings.includes("LATENCY_POOR"));
});
